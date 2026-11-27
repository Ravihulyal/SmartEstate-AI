import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { RequestHandler } from "express";
import type { Server } from "socket.io";
import prisma from "../config/prisma";
import { authenticateToken } from "../middleware/auth.middleware";
import { authorizeRoles } from "../middleware/role.middleware";
import { createPaymentHandlers } from "../controllers/payment.controller";

const simulatedPaymentRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many simulated payment attempts. Please try again later."
  }
});

export function createPaymentRouter(
  io: Server,
  database: typeof prisma = prisma,
  simulationLimiter: RequestHandler = simulatedPaymentRateLimit
): Router {
  const router = Router();
  const handlers = createPaymentHandlers(io, database);

  router.get(
    "/mine/pending",
    authenticateToken,
    authorizeRoles("BUYER"),
    handlers.getBuyerPending
  );
  router.get(
    "/mine/history",
    authenticateToken,
    authorizeRoles("BUYER"),
    handlers.getBuyerHistory
  );
  router.get(
    "/seller/payments",
    authenticateToken,
    authorizeRoles("SELLER"),
    handlers.getSellerPayments
  );
  router.get(
    "/seller/closings",
    authenticateToken,
    authorizeRoles("SELLER"),
    handlers.getSellerClosings
  );
  router.post(
    "/seller/closings/:id/confirm",
    authenticateToken,
    authorizeRoles("SELLER"),
    handlers.confirmSellerClosing
  );
  router.get(
    "/admin/all",
    authenticateToken,
    authorizeRoles("ADMIN"),
    handlers.getAdminPayments
  );
  router.get(
    "/admin/closings",
    authenticateToken,
    authorizeRoles("ADMIN"),
    handlers.getAdminClosings
  );
  router.get(
    "/admin/audit",
    authenticateToken,
    authorizeRoles("ADMIN"),
    handlers.getAdminAudit
  );
  router.post(
    "/:id/retry",
    authenticateToken,
    authorizeRoles("BUYER"),
    simulationLimiter,
    handlers.retryBuyerPayment
  );
  router.post(
    "/:id/simulate",
    authenticateToken,
    authorizeRoles("BUYER"),
    simulationLimiter,
    handlers.simulateBuyerPayment
  );
  router.get(
    "/:id",
    authenticateToken,
    authorizeRoles("BUYER"),
    handlers.getBuyerPayment
  );

  return router;
}
