
import axios from "axios";

const ML_SERVICE_URL =
  process.env.ML_SERVICE_URL || "http://127.0.0.1:8000";

const mlClient = axios.create({
  baseURL: ML_SERVICE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json"
  }
});

export interface PricePredictionInput {
  location: string;
  total_sqft: number;
  bhk: number;
  bath: number;
}

export interface PricePredictionResponse {
  algorithm: string;
  predicted_price_lakhs: number;
  currency: "INR";
  unit: "Lakhs";
}

export interface FraudDetectionInput {
  location: string;
  total_sqft: number;
  bhk: number;
  bath: number;
  price: number;
}

export interface RiskClassificationInput extends FraudDetectionInput {}

export interface RecommendationInput {
  location: string;
  budget: number;
  bhk: number;
  area: number;
  top_n?: number;
}

// 1. Random Forest - Price Prediction
export async function predictPrice(
  data: PricePredictionInput
): Promise<PricePredictionResponse> {
  const response = await mlClient.post(
    "/predict-price",
    data
  );

  return response.data as PricePredictionResponse;
}

// 2. Isolation Forest - Fraud Detection
export async function detectFraud(data: FraudDetectionInput) {
  const response = await mlClient.post(
    "/detect-fraud",
    data
  );

  return response.data;
}

// 3. Logistic Regression - Risk Classification
export async function classifyRisk(data: RiskClassificationInput) {
  const response = await mlClient.post(
    "/classify-risk",
    data
  );

  return response.data;
}

// 4. Content-Based Filtering - Recommendations
export async function recommendProperties(data: RecommendationInput) {
  const response = await mlClient.post(
    "/recommend",
    data
  );

  return response.data;
}
