
import { Router, Request, Response } from "express";
import axios, { AxiosError } from "axios";

import {
  predictPrice,
  detectFraud,
  classifyRisk,
  recommendProperties
} from "../services/ml.service";

const router = Router();

// Handle ML service errors
function handleError(error: unknown, res: Response) {
  if (!axios.isAxiosError(error)) {
    console.error("ML Service Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal ML integration error"
    });
  }

  const axiosError = error as AxiosError<unknown>;
  console.error("ML Service Error:", axiosError.message);

  if (axiosError.code === "ECONNREFUSED" || axiosError.code === "ETIMEDOUT") {
    return res.status(503).json({
      success: false,
      message: "ML service is unavailable. Start FastAPI."
    });
  }

  if (error.response) {
    return res.status(error.response.status).json({
      success: false,
      message: "ML service returned an error",
      details: error.response.data
    });
  }

  return res.status(500).json({
    success: false,
    message: "Internal ML integration error"
  });
}

// 1. Price prediction
router.post("/predict-price", async (req: Request, res: Response) => {
  try {
    const result = await predictPrice(req.body);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    handleError(error, res);
  }
});

// 2. Fraud detection
router.post("/detect-fraud", async (req: Request, res: Response) => {
  try {
    const result = await detectFraud(req.body);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    handleError(error, res);
  }
});

// 3. Risk classification
router.post("/classify-risk", async (req: Request, res: Response) => {
  try {
    const result = await classifyRisk(req.body);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    handleError(error, res);
  }
});

// 4. Property recommendations
router.post("/recommend", async (req: Request, res: Response) => {
  try {
    const result = await recommendProperties(req.body);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
