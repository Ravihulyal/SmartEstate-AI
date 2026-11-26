
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import type { Server } from "socket.io";

import authRoutes from "./routes/auth.routes";
import { createAuctionRouter } from "./routes/auction.routes";
import favoritesRoutes from "./routes/favorites.routes";
import mlRoutes from "./routes/ml.routes";
import propertyRoutes from "./routes/property.routes";

export function createApp(io: Server) {
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
  app.use("/api/v1/auctions", createAuctionRouter(io));
  app.use("/api/v1/favorites", favoritesRoutes);
  app.use("/api/v1/properties", propertyRoutes);
  app.use("/api/v1/ml", mlRoutes);

  return app;
}
