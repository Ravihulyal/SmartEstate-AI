import { PaymentStatus, Prisma, SaleClosingStatus } from "@prisma/client";
import type { Request, Response } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/auth.middleware";
import { expirePaymentIfDue, PaymentWorkflowError, paymentDetailsInclude, retryPayment, simulatePayment } from "../services/simulated-payment.service";
import {
  completeSaleClosing,
  saleClosingDetailsInclude
} from "../services/sale-closing.service";

const idSchema = z.string().cuid();
const paymentStatuses = ["PENDING", "SUCCESS", "FAILED", "EXPIRED"] as const;
const closingStatuses = ["PENDING", "COMPLETED", "CANCELLED"] as const;

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(paymentStatuses).optional()
}).strict();

const closingPageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(closingStatuses).optional()
}).strict();

const adminAuditSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  auctionId: idSchema.optional(),
  paymentId: idSchema.optional(),
  saleClosingId: idSchema.optional()
}).strict();

const simulationSchema = z.object({
  outcome: z.enum(["SUCCESS", "FAILED"])
}).strict();

function paymentView(payment: Prisma.PaymentGetPayload<{
  include: typeof paymentDetailsInclude;
}>, includeReceipt = true) {
  return {
    id: payment.id,
    auctionId: payment.auctionId,
    propertyId: payment.propertyId,
    status: payment.status,
    amount: payment.amount.toFixed(2),
    currency: payment.currency,
    transactionReference: payment.transactionReference,
    provider: "SIMULATED",
    paymentMode: "SIMULATED",
    isRealPayment: false,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
    paidAt: payment.paidAt?.toISOString() ?? null,
    expiresAt: payment.expiresAt?.toISOString() ?? null,
    failureReason: payment.failureReason,
    auction: {
      status: payment.auction.status,
      outcomeStatus: payment.auction.outcomeStatus
    },
    property: {
      id: payment.property.id,
      title: payment.property.title,
      city: payment.property.city,
      state: payment.property.state,
      images: payment.property.images
    },
    saleClosing: payment.saleClosing ? {
      id: payment.saleClosing.id,
      status: payment.saleClosing.status,
      createdAt: payment.saleClosing.createdAt.toISOString(),
      completedAt: payment.saleClosing.completedAt?.toISOString() ?? null
    } : null,
    simulatedReceipt: includeReceipt && payment.status === "SUCCESS" ? {
      receiptReference: `SIM-RECEIPT-${payment.transactionReference}`,
      transactionReference: payment.transactionReference,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      paidAt: payment.paidAt?.toISOString() ?? null,
      paymentMode: "SIMULATED",
      isRealPayment: false
    } : null
  };
}

function sellerPaymentView(payment: Prisma.PaymentGetPayload<{
  include: typeof paymentDetailsInclude;
}>) {
  const view = paymentView(payment, false);
  return { ...view, simulatedReceipt: undefined };
}

function closingView(closing: Prisma.SaleClosingGetPayload<{
  include: typeof saleClosingDetailsInclude;
}>) {
  return {
    id: closing.id,
    auctionId: closing.auctionId,
    propertyId: closing.propertyId,
    paymentId: closing.paymentId,
    status: closing.status,
    createdAt: closing.createdAt.toISOString(),
    completedAt: closing.completedAt?.toISOString() ?? null,
    paymentMode: "SIMULATED",
    isRealPayment: false,
    transactionReference: closing.payment.transactionReference,
    paymentStatus: closing.payment.status,
    amount: closing.payment.amount.toFixed(2),
    currency: closing.payment.currency,
    property: {
      id: closing.property.id,
      title: closing.property.title,
      city: closing.property.city,
      state: closing.property.state,
      images: closing.property.images,
      status: closing.property.status
    },
    auction: {
      status: closing.auction.status,
      outcomeStatus: closing.auction.outcomeStatus
    }
  };
}

function adminPaymentView(payment: Prisma.PaymentGetPayload<{
  include: typeof paymentDetailsInclude;
}>) {
  return {
    id: payment.id,
    auctionId: payment.auctionId,
    propertyId: payment.propertyId,
    status: payment.status,
    amount: payment.amount.toFixed(2),
    currency: payment.currency,
    transactionReference: payment.transactionReference,
    provider: "SIMULATED",
    paymentMode: "SIMULATED",
    isRealPayment: false,
    createdAt: payment.createdAt.toISOString(),
    paidAt: payment.paidAt?.toISOString() ?? null,
    expiresAt: payment.expiresAt?.toISOString() ?? null,
    saleClosingStatus: payment.saleClosing?.status ?? null,
    property: {
      title: payment.property.title,
      city: payment.property.city,
      state: payment.property.state
    },
    auctionOutcomeStatus: payment.auction.outcomeStatus
  };
}

function requestError(res: Response, error: unknown, operation: string) {
  if (error instanceof PaymentWorkflowError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      paymentMode: "SIMULATED",
      isRealPayment: false
    });
  }
  const code = error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code
    : "unexpected";
  console.error(`Payment ${operation} failed (${code})`);
  return res.status(500).json({
    success: false,
    message: "Unable to complete the payment workflow"
  });
}

function parseId(value: unknown): string | null {
  const parsed = idSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function pagination(query: Request["query"], schema: typeof pageSchema | typeof closingPageSchema) {
  const parsed = schema.safeParse(query);
  if (!parsed.success) return null;
  return parsed.data;
}

export function createPaymentHandlers(
  io: Server,
  database: typeof prisma = prisma
) {
  return {
    async getBuyerPending(req: AuthRequest, res: Response) {
      try {
        const payments = await database.payment.findMany({
          where: { buyerId: req.user!.id, status: "PENDING" },
          orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
          include: paymentDetailsInclude
        });
        return res.status(200).json({
          success: true,
          count: payments.length,
          payments: payments.map((payment) => paymentView(payment)),
          paymentMode: "SIMULATED",
          isRealPayment: false
        });
      } catch (error) {
        return requestError(res, error, "pending list");
      }
    },

    async getBuyerHistory(req: AuthRequest, res: Response) {
      const query = pagination(req.query, pageSchema);
      if (!query) {
        return res.status(400).json({ success: false, message: "Invalid payment history filters" });
      }
      try {
        const payments = await database.payment.findMany({
          where: {
            buyerId: req.user!.id,
            ...(query.status ? { status: query.status as PaymentStatus } : {})
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.limit,
          take: query.limit + 1,
          include: paymentDetailsInclude
        });
        const hasMore = payments.length > query.limit;
        const items = payments.slice(0, query.limit);
        return res.status(200).json({
          success: true,
          payments: items.map((payment) => paymentView(payment)),
          pagination: { page: query.page, limit: query.limit, hasMore },
          paymentMode: "SIMULATED",
          isRealPayment: false
        });
      } catch (error) {
        return requestError(res, error, "buyer history");
      }
    },

    async getBuyerPayment(req: AuthRequest, res: Response) {
      const paymentId = parseId(req.params.id);
      if (!paymentId) return res.status(400).json({ success: false, message: "Invalid payment ID" });
      try {
        const owned = await database.payment.findFirst({
          where: { id: paymentId, buyerId: req.user!.id },
          select: { id: true }
        });
        if (!owned) return res.status(404).json({ success: false, message: "Payment request not found" });
        await expirePaymentIfDue(io, database, paymentId, new Date(), req.user!.id);
        const payment = await database.payment.findFirst({
          where: { id: paymentId, buyerId: req.user!.id },
          include: paymentDetailsInclude
        });
        if (!payment) return res.status(404).json({ success: false, message: "Payment request not found" });
        return res.status(200).json({
          success: true,
          payment: paymentView(payment),
          paymentMode: "SIMULATED",
          isRealPayment: false
        });
      } catch (error) {
        return requestError(res, error, "buyer detail");
      }
    },

    async simulateBuyerPayment(req: AuthRequest, res: Response) {
      const paymentId = parseId(req.params.id);
      if (!paymentId) return res.status(400).json({ success: false, message: "Invalid payment ID" });
      const parsed = simulationSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: "Choose a simulated outcome of SUCCESS or FAILED"
        });
      }
      try {
        const result = await simulatePayment(io, database, {
          paymentId,
          buyerId: req.user!.id,
          outcome: parsed.data.outcome
        });
        if (result.kind === "EXPIRED") {
          return res.status(409).json({
            success: false,
            message: "Payment request has expired",
            payment: paymentView(result.payment),
            paymentMode: "SIMULATED",
            isRealPayment: false
          });
        }
        return res.status(200).json({
          success: true,
          message: result.kind === "SUCCESS"
            ? "Simulated payment succeeded"
            : "Simulated payment failed",
          payment: paymentView(result.payment),
          saleClosing: result.saleClosing,
          paymentMode: "SIMULATED",
          isRealPayment: false
        });
      } catch (error) {
        return requestError(res, error, "simulation");
      }
    },

    async retryBuyerPayment(req: AuthRequest, res: Response) {
      const paymentId = parseId(req.params.id);
      if (!paymentId) return res.status(400).json({ success: false, message: "Invalid payment ID" });
      if (!z.object({}).strict().safeParse(req.body ?? {}).success) {
        return res.status(400).json({ success: false, message: "Retry requests must not include a body" });
      }
      try {
        const payment = await retryPayment(io, database, {
          paymentId,
          buyerId: req.user!.id
        });
        return res.status(200).json({
          success: true,
          message: "A new simulated payment attempt has been created",
          payment: paymentView(payment),
          paymentMode: "SIMULATED",
          isRealPayment: false
        });
      } catch (error) {
        return requestError(res, error, "retry");
      }
    },

    async getSellerPayments(req: AuthRequest, res: Response) {
      const query = pagination(req.query, pageSchema);
      if (!query) {
        return res.status(400).json({ success: false, message: "Invalid seller payment filters" });
      }
      try {
        const payments = await database.payment.findMany({
          where: {
            sellerId: req.user!.id,
            property: { is: { sellerId: req.user!.id } },
            ...(query.status ? { status: query.status as PaymentStatus } : {})
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.limit,
          take: query.limit + 1,
          include: paymentDetailsInclude
        });
        const hasMore = payments.length > query.limit;
        return res.status(200).json({
          success: true,
          payments: payments.slice(0, query.limit).map(sellerPaymentView),
          pagination: { page: query.page, limit: query.limit, hasMore },
          paymentMode: "SIMULATED",
          isRealPayment: false
        });
      } catch (error) {
        return requestError(res, error, "seller payments");
      }
    },

    async getSellerClosings(req: AuthRequest, res: Response) {
      const query = pagination(req.query, closingPageSchema);
      if (!query) {
        return res.status(400).json({ success: false, message: "Invalid seller closing filters" });
      }
      try {
        const closings = await database.saleClosing.findMany({
          where: {
            sellerId: req.user!.id,
            property: { is: { sellerId: req.user!.id } },
            ...(query.status ? { status: query.status as SaleClosingStatus } : {})
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.limit,
          take: query.limit + 1,
          include: saleClosingDetailsInclude
        });
        const hasMore = closings.length > query.limit;
        return res.status(200).json({
          success: true,
          closings: closings.slice(0, query.limit).map(closingView),
          pagination: { page: query.page, limit: query.limit, hasMore },
          paymentMode: "SIMULATED",
          isRealPayment: false
        });
      } catch (error) {
        return requestError(res, error, "seller closings");
      }
    },

    async confirmSellerClosing(req: AuthRequest, res: Response) {
      const closingId = parseId(req.params.id);
      if (!closingId) return res.status(400).json({ success: false, message: "Invalid sale closing ID" });
      try {
        const closing = await completeSaleClosing(io, database, {
          closingId,
          sellerId: req.user!.id
        });
        return res.status(200).json({
          success: true,
          message: "Demo sale closing completed; this does not transfer legal title",
          closing: closingView(closing),
          paymentMode: "SIMULATED",
          isRealPayment: false
        });
      } catch (error) {
        return requestError(res, error, "seller closing confirmation");
      }
    },

    async getAdminPayments(req: AuthRequest, res: Response) {
      const query = pagination(req.query, pageSchema);
      if (!query) {
        return res.status(400).json({ success: false, message: "Invalid payment monitoring filters" });
      }
      try {
        const payments = await database.payment.findMany({
          where: query.status ? { status: query.status as PaymentStatus } : {},
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.limit,
          take: query.limit + 1,
          include: paymentDetailsInclude
        });
        const hasMore = payments.length > query.limit;
        return res.status(200).json({
          success: true,
          payments: payments.slice(0, query.limit).map(adminPaymentView),
          pagination: { page: query.page, limit: query.limit, hasMore },
          paymentMode: "SIMULATED",
          isRealPayment: false
        });
      } catch (error) {
        return requestError(res, error, "admin payment monitoring");
      }
    },

    async getAdminClosings(req: AuthRequest, res: Response) {
      const query = pagination(req.query, closingPageSchema);
      if (!query) {
        return res.status(400).json({ success: false, message: "Invalid closing monitoring filters" });
      }
      try {
        const closings = await database.saleClosing.findMany({
          where: query.status ? { status: query.status as SaleClosingStatus } : {},
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.limit,
          take: query.limit + 1,
          include: saleClosingDetailsInclude
        });
        const hasMore = closings.length > query.limit;
        return res.status(200).json({
          success: true,
          closings: closings.slice(0, query.limit).map(closingView),
          pagination: { page: query.page, limit: query.limit, hasMore },
          paymentMode: "SIMULATED",
          isRealPayment: false
        });
      } catch (error) {
        return requestError(res, error, "admin closing monitoring");
      }
    },

    async getAdminAudit(req: AuthRequest, res: Response) {
      const query = adminAuditSchema.safeParse(req.query);
      if (!query.success) {
        return res.status(400).json({ success: false, message: "Invalid audit filters" });
      }
      try {
        const logs = await database.auctionAuditLog.findMany({
          where: {
            ...(query.data.auctionId ? { auctionId: query.data.auctionId } : {}),
            ...(query.data.paymentId ? { paymentId: query.data.paymentId } : {}),
            ...(query.data.saleClosingId ? { saleClosingId: query.data.saleClosingId } : {})
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.data.page - 1) * query.data.limit,
          take: query.data.limit + 1,
          select: {
            id: true,
            auctionId: true,
            paymentId: true,
            saleClosingId: true,
            adminId: true,
            sellerId: true,
            buyerId: true,
            action: true,
            reason: true,
            createdAt: true
          }
        });
        const hasMore = logs.length > query.data.limit;
        return res.status(200).json({
          success: true,
          audit: logs.slice(0, query.data.limit),
          pagination: {
            page: query.data.page,
            limit: query.data.limit,
            hasMore
          },
          paymentMode: "SIMULATED",
          isRealPayment: false
        });
      } catch (error) {
        return requestError(res, error, "admin audit monitoring");
      }
    }
  };
}
