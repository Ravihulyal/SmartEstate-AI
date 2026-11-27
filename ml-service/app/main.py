
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pathlib import Path
import logging
import pandas as pd
import joblib
import math

from app.models.recommend_model import recommend_properties


# Project paths
BASE_DIR = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = BASE_DIR / "artifacts"
logger = logging.getLogger(__name__)


# Load trained models
price_model = joblib.load(
    ARTIFACT_DIR / "price_model.joblib"
)

fraud_model = joblib.load(
    ARTIFACT_DIR / "fraud_model.joblib"
)

risk_data = joblib.load(
    ARTIFACT_DIR / "risk_model.joblib"
)

risk_model = risk_data["model"]
location_medians = risk_data["location_medians"]
global_median = risk_data["global_median"]


# Create FastAPI application
app = FastAPI(
    title="SmartEstate AI",
    description="AI-powered property intelligence platform",
    version="1.0.0"
)


@app.exception_handler(RequestValidationError)
async def handle_request_validation_error(
    _request: Request,
    exc: RequestValidationError
) -> JSONResponse:
    errors = [
        {
            "loc": list(error["loc"]),
            "msg": error["msg"],
            "type": error["type"]
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={"detail": errors}
    )


# Request schemas
class PricePredictionInput(BaseModel):
    location: str = Field(min_length=1, max_length=120)
    total_sqft: float = Field(gt=0, allow_inf_nan=False)
    bhk: int = Field(gt=0, le=20)
    bath: float = Field(gt=0, allow_inf_nan=False)


class FraudRiskInput(BaseModel):
    location: str = Field(min_length=1, max_length=120)
    total_sqft: float = Field(gt=0, allow_inf_nan=False)
    bhk: int = Field(gt=0, le=20)
    bath: float = Field(gt=0, allow_inf_nan=False)
    price: float = Field(gt=0, allow_inf_nan=False, description="Price in INR lakhs")


class RecommendationInput(BaseModel):
    location: str = Field(min_length=1, max_length=120)
    budget: float = Field(gt=0, allow_inf_nan=False, description="Budget in INR lakhs")
    bhk: int = Field(gt=0, le=20)
    area: float = Field(gt=0, allow_inf_nan=False)
    top_n: int = Field(default=5, ge=1, le=20)


# Home endpoint
@app.get("/")
def home():
    return {
        "message": "Welcome to SmartEstate AI ML Service",
        "status": "running"
    }


# Health endpoint
@app.get("/health")
def health():
    return {
        "status": "healthy",
        "models": {
            "price_prediction": "loaded",
            "fraud_detection": "loaded",
            "risk_classification": "loaded",
            "recommendation": "available"
        }
    }


# 1. Random Forest - Price Prediction
@app.post("/predict-price")
def predict_price(data: PricePredictionInput):

    property_data = pd.DataFrame([{
        "location": data.location,
        "total_sqft": data.total_sqft,
        "bhk": data.bhk,
        "bath": data.bath
    }])

    prediction = price_model.predict(property_data)[0]
    predicted_price = float(prediction)

    if not math.isfinite(predicted_price) or predicted_price <= 0:
        raise HTTPException(
            status_code=502,
            detail="Price model returned an invalid prediction"
        )

    return {
        "algorithm": "Random Forest",
        "predicted_price_lakhs": round(predicted_price, 2),
        "currency": "INR",
        "unit": "Lakhs"
    }


# 2. Isolation Forest - Anomaly Detection
@app.post("/detect-fraud")
def detect_fraud(data: FraudRiskInput):

    price_per_sqft = (
        data.price * 100000
    ) / data.total_sqft

    property_data = pd.DataFrame([{
        "total_sqft": data.total_sqft,
        "bhk": data.bhk,
        "bath": data.bath,
        "price": data.price,
        "price_per_sqft": price_per_sqft
    }])

    prediction = fraud_model.predict(property_data)[0]

    anomaly_score = fraud_model.decision_function(
        property_data
    )[0]
    anomaly_score = float(anomaly_score)
    if not math.isfinite(anomaly_score):
        raise HTTPException(
            status_code=502,
            detail="Anomaly model returned an invalid score"
        )

    return {
        "algorithm": "Isolation Forest",
        "status": (
            "Suspicious" if prediction == -1 else "Normal"
        ),
        "anomaly_score": round(anomaly_score, 4),
        "interpretation": "An unusual-pattern signal for review only; it is not proof of fraud.",
        "message": (
            "Unusual property pattern detected"
            if prediction == -1
            else "No unusual pattern detected"
        )
    }


# 3. Logistic Regression - Risk Classification
@app.post("/classify-risk")
def classify_risk(data: FraudRiskInput):

    price_per_sqft = (
        data.price * 100000
    ) / data.total_sqft

    median_price = location_medians.get(
        data.location,
        global_median
    )

    property_features = pd.DataFrame([{
        "price_ratio": price_per_sqft / median_price,
        "sqft_per_bhk": data.total_sqft / data.bhk,
        "bath_per_bhk": data.bath / data.bhk
    }])

    prediction = risk_model.predict(property_features)[0]

    probability = risk_model.predict_proba(
        property_features
    )[0][1]
    probability = float(probability)
    if not math.isfinite(probability) or probability < 0 or probability > 1:
        raise HTTPException(
            status_code=502,
            detail="Risk model returned an invalid probability"
        )

    return {
        "algorithm": "Logistic Regression",
        "risk_status": (
            "High Risk" if prediction == 1 else "Normal"
        ),
        "high_risk_probability": round(
            probability * 100, 2
        ),
        "evaluation_note": "Training labels are rule-generated demonstration labels and are not verified real-world fraud outcomes."
    }


# 4. Content-Based Filtering - Recommendations
@app.post("/recommend")
def recommend(data: RecommendationInput):

    try:
        results = recommend_properties(
            location=data.location,
            budget=data.budget,
            bhk=data.bhk,
            area=data.area,
            top_n=data.top_n
        )

        return {
            "algorithm": "Content-Based Filtering",
            "total_recommendations": len(results),
            "recommendations": results
        }

    except Exception:
        logger.exception("Recommendation request failed")
        raise HTTPException(
            status_code=500,
            detail="Recommendation service failed"
        ) from None
