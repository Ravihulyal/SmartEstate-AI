
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import authRoutes from "./routes/auth.routes";
import mlRoutes from "./routes/ml.routes";
import propertyRoutes from "./routes/property.routes";

const app = express();

// MIDDLEWARE
app.use(helmet());

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173"
}));

// Parse JSON before registering routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HEALTH CHECK
app.get("/api/v1/health", (req, res) => {
  res.json({
    success: true,
    message: "SmartEstate backend is running"
  });
});

// API ROUTES
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/properties", propertyRoutes);
app.use("/api/v1/ml", mlRoutes);

export default app;
