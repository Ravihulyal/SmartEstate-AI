import { Router } from "express";
import type { Server } from "socket.io";
import { createAuctionHandlers } from "../controllers/auction.controller";
import prisma from "../config/prisma";
import { authenticateToken, optionalAuthenticateToken } from "../middleware/auth.middleware";
import { authorizeRoles } from "../middleware/role.middleware";

export function createAuctionRouter(
  io: Server,
  database: typeof prisma = prisma
): Router {
  const router = Router();
  const handlers = createAuctionHandlers(io, database);

  router.get("/admin/all", authenticateToken, authorizeRoles("ADMIN"), handlers.getAllAuctions);
  router.get(
    "/seller/pending-approval",
    authenticateToken,
    authorizeRoles("SELLER"),
    handlers.getPendingSellerApprovals
  );
  router.get("/seller/mine", authenticateToken, authorizeRoles("SELLER"), handlers.getMyAuctions);
  router.get("/:id/audit", authenticateToken, authorizeRoles("ADMIN"), handlers.getAuctionAudit);
  router.patch(
    "/:id/schedule",
    authenticateToken,
    authorizeRoles("SELLER", "ADMIN"),
    handlers.updateSchedule
  );
  router.post(
    "/:id/cancel",
    authenticateToken,
    authorizeRoles("SELLER", "ADMIN"),
    handlers.cancelAuction
  );
  router.post(
    "/:id/end-early",
    authenticateToken,
    authorizeRoles("ADMIN"),
    handlers.endAuctionEarly
  );
  router.post(
    "/:id/approve-winner",
    authenticateToken,
    authorizeRoles("SELLER"),
    handlers.approveWinner
  );
  router.post(
    "/:id/reject-winner",
    authenticateToken,
    authorizeRoles("SELLER"),
    handlers.rejectWinner
  );
  router.get("/", handlers.getAuctions);
  router.get("/:id/bids", handlers.getBids);
  router.get("/:id", optionalAuthenticateToken, handlers.getAuction);
  router.post("/", authenticateToken, authorizeRoles("SELLER"), handlers.createAuction);
  router.post("/:id/bids", authenticateToken, authorizeRoles("BUYER"), handlers.placeBid);

  return router;
}
