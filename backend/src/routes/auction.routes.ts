import { Router } from "express";
import type { Server } from "socket.io";
import { createAuctionHandlers } from "../controllers/auction.controller";
import { authenticateToken } from "../middleware/auth.middleware";
import { authorizeRoles } from "../middleware/role.middleware";

export function createAuctionRouter(io: Server): Router {
  const router = Router();
  const handlers = createAuctionHandlers(io);

  router.get("/", handlers.getAuctions);
  router.get("/:id/bids", handlers.getBids);
  router.get("/:id", handlers.getAuction);
  router.post("/", authenticateToken, authorizeRoles("SELLER"), handlers.createAuction);
  router.post("/:id/bids", authenticateToken, authorizeRoles("BUYER"), handlers.placeBid);

  return router;
}
