
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from pathlib import Path
import pandas as pd
import joblib
import math

from app.models.recommend_model import recommend_properties


# Project paths
BASE_DIR = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = BASE_DIR / "artifacts"


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


# Request schemas
class PricePredictionInput(BaseModel):
    location: str = Field(min_length=1)
    total_sqft: float = Field(gt=0)
    bhk: int = Field(gt=0)
    bath: float = Field(gt=0)


class FraudRiskInput(BaseModel):
    location: str = Field(min_length=1)
    total_sqft: float = Field(gt=0)
    bhk: int = Field(gt=0)
    bath: float = Field(gt=0)
    price: float = Field(gt=0)


class RecommendationInput(BaseModel):
    location: str = Field(min_length=1)
    budget: float = Field(gt=0)
    bhk: int = Field(gt=0)
    area: float = Field(gt=0)
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

    return {
        "algorithm": "Isolation Forest",
        "status": (
            "Suspicious" if prediction == -1 else "Normal"
        ),
        "anomaly_score": round(float(anomaly_score), 4),
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

    return {
        "algorithm": "Logistic Regression",
        "risk_status": (
            "High Risk" if prediction == 1 else "Normal"
        ),
        "high_risk_probability": round(
            float(probability) * 100, 2
        )
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

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error)
        )
