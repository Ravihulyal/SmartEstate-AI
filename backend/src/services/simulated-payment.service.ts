import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Server } from "socket.io";
import prisma from "../config/prisma";
import { PAYMENT_EXPIRY_MS } from "../config/payment.config";
import { broadcastPaymentEvent } from "./payment-socket.service";

export class PaymentWorkflowError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export const paymentDetailsInclude = {
  auction: {
    select: {
      id: true,
      status: true,
      outcomeStatus: true,
      winningBidId: true,
      propertyId: true
    }
  },
  property: {
    select: {
      id: true,
      title: true,
      city: true,
      state: true,
      images: true,
      status: true,
      sellerId: true
    }
  },
  winningBid: {
    select: {
      id: true,
      amount: true,
      bidderId: true
    }
  },
  saleClosing: {
    select: {
      id: true,
      status: true,
      createdAt: true,
      completedAt: true
    }
  }
} satisfies Prisma.PaymentInclude;

export type PaymentDetails = Prisma.PaymentGetPayload<{
  include: typeof paymentDetailsInclude;
}>;

export type PaymentDatabase = typeof prisma;

export function createTransactionReference(): string {
  return `SIM-PAY-${randomUUID()}`;
}

export function getPaymentExpiry(now: Date): Date {
  return new Date(now.getTime() + PAYMENT_EXPIRY_MS);
}

function paymentAmount(amount: number): Prisma.Decimal {
  if (
    !Number.isFinite(amount)
    || amount <= 0
    || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7
  ) {
    throw new PaymentWorkflowError(409, "Winning bid amount cannot be represented as an INR payment");
  }
  return new Prisma.Decimal(amount.toFixed(2));
}

function auditPaymentAction(
  transaction: Prisma.TransactionClient,
  payment: Pick<PaymentDetails, "id" | "auctionId" | "buyerId" | "sellerId">,
  action: "PAYMENT_CREATED" | "PAYMENT_INITIATED" | "PAYMENT_RETRY_INITIATED" | "PAYMENT_SUCCEEDED" | "PAYMENT_FAILED" | "PAYMENT_EXPIRED" | "SALE_CLOSING_CREATED",
  reason: string,
  saleClosingId?: string
) {
  return transaction.auctionAuditLog.create({
    data: {
      auctionId: payment.auctionId,
      buyerId: payment.buyerId,
      sellerId: payment.sellerId,
      paymentId: payment.id,
      ...(saleClosingId ? { saleClosingId } : {}),
      action,
      reason
    }
  });
}

export async function createPaymentRequestForAcceptedAuction(
  transaction: Prisma.TransactionClient,
  input: {
    auctionId: string;
    propertyId: string;
    winningBidId: string;
    buyerId: string;
    sellerId: string;
    amount: number;
    now?: Date;
  }
): Promise<PaymentDetails> {
  const existing = await transaction.payment.findFirst({
    where: { auctionId: input.auctionId },
    select: { id: true }
  });
  if (existing) {
    throw new PaymentWorkflowError(409, "A payment request already exists for this auction");
  }

  const now = input.now ?? new Date();
  const transactionReference = createTransactionReference();
  const payment = await transaction.payment.create({
    data: {
      auctionId: input.auctionId,
      propertyId: input.propertyId,
      winningBidId: input.winningBidId,
      buyerId: input.buyerId,
      sellerId: input.sellerId,
      amount: paymentAmount(input.amount),
      currency: "INR",
      status: "PENDING",
      transactionReference,
      provider: "SIMULATED",
      providerReference: null,
      isSimulated: true,
      expiresAt: getPaymentExpiry(now)
    },
    include: paymentDetailsInclude
  });

  await auditPaymentAction(
    transaction,
    payment,
    "PAYMENT_CREATED",
    `Simulated payment request created; transaction reference ${transactionReference}`
  );
  return payment;
}

function assertPaymentContext(payment: PaymentDetails): void {
  if (
    payment.provider !== "SIMULATED"
    || !payment.isSimulated
    || payment.currency !== "INR"
  ) {
    throw new PaymentWorkflowError(409, "This payment is not an eligible simulated INR payment");
  }
  if (
    payment.auction.outcomeStatus !== "ACCEPTED"
    || payment.auction.winningBidId !== payment.winningBidId
    || payment.auction.propertyId !== payment.propertyId
    || payment.winningBid.id !== payment.winningBidId
    || payment.winningBid.bidderId !== payment.buyerId
    || payment.property.sellerId !== payment.sellerId
    || !payment.amount.equals(paymentAmount(payment.winningBid.amount))
  ) {
    throw new PaymentWorkflowError(409, "Payment no longer matches the accepted winning bid");
  }
}

function privatePaymentPayload(
  payment: PaymentDetails,
  closing?: { id: string; status: string }
): Record<string, unknown> {
  return {
    paymentId: payment.id,
    auctionId: payment.auctionId,
    status: payment.status,
    amount: payment.amount.toFixed(2),
    currency: payment.currency,
    transactionReference: payment.transactionReference,
    expiresAt: payment.expiresAt?.toISOString() ?? null,
    ...(closing ? { saleClosing: closing } : {}),
    paymentMode: "SIMULATED",
    isRealPayment: false
  };
}

function adminPaymentPayload(payment: PaymentDetails): Record<string, unknown> {
  return {
    paymentId: payment.id,
    auctionId: payment.auctionId,
    propertyId: payment.propertyId,
    status: payment.status,
    amount: payment.amount.toFixed(2),
    currency: payment.currency,
    transactionReference: payment.transactionReference,
    paymentMode: "SIMULATED",
    isRealPayment: false
  };
}

async function lockPayment(transaction: Prisma.TransactionClient, paymentId: string): Promise<void> {
  const locked = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE
  `;
  if (locked.length === 0) {
    throw new PaymentWorkflowError(404, "Payment request not found");
  }
}

async function markPaymentExpired(
  transaction: Prisma.TransactionClient,
  payment: PaymentDetails,
  now: Date
): Promise<PaymentDetails> {
  const updated = await transaction.payment.update({
    where: { id: payment.id },
    data: {
      status: "EXPIRED",
      failureReason: "Simulated payment request expired"
    },
    include: paymentDetailsInclude
  });
  await auditPaymentAction(
    transaction,
    payment,
    "PAYMENT_EXPIRED",
    `Simulated payment expired; transaction reference ${payment.transactionReference}; expired at ${now.toISOString()}`
  );
  return updated;
}

export async function expirePaymentIfDue(
  io: Server,
  database: PaymentDatabase,
  paymentId: string,
  now = new Date(),
  expectedBuyerId?: string
): Promise<PaymentDetails | null> {
  const expired = await database.$transaction(async (transaction) => {
    await lockPayment(transaction, paymentId);
    const payment = await transaction.payment.findUnique({
      where: { id: paymentId },
      include: paymentDetailsInclude
    });
    if (!payment || (expectedBuyerId && payment.buyerId !== expectedBuyerId)) {
      return null;
    }
    if (payment.status !== "PENDING") return null;
    if (payment.expiresAt && payment.expiresAt > now) return null;
    return markPaymentExpired(transaction, payment, now);
  });

  if (expired) {
    broadcastPaymentEvent(
      io,
      "payment:expired",
      { buyerId: expired.buyerId, sellerId: expired.sellerId },
      privatePaymentPayload(expired),
      adminPaymentPayload(expired)
    );
  }
  return expired;
}

export async function expireDuePaymentRequests(
  io: Server,
  database: PaymentDatabase = prisma,
  filter: { buyerId?: string; sellerId?: string } = {},
  now = new Date()
): Promise<number> {
  const due = await database.payment.findMany({
    where: {
      status: "PENDING",
      OR: [{ expiresAt: null }, { expiresAt: { lte: now } }],
      ...(filter.buyerId ? { buyerId: filter.buyerId } : {}),
      ...(filter.sellerId ? { sellerId: filter.sellerId } : {})
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true }
  });
  let expiredCount = 0;
  for (const candidate of due) {
    if (await expirePaymentIfDue(io, database, candidate.id, now)) {
      expiredCount += 1;
    }
  }
  return expiredCount;
}

export async function simulatePayment(
  io: Server,
  database: PaymentDatabase,
  input: {
    paymentId: string;
    buyerId: string;
    outcome: "SUCCESS" | "FAILED";
    now?: Date;
  }
): Promise<{
  kind: "SUCCESS" | "FAILED" | "EXPIRED";
  payment: PaymentDetails;
  saleClosing: { id: string; status: "PENDING" } | null;
}> {
  const now = input.now ?? new Date();
  const result = await database.$transaction(async (transaction) => {
    await lockPayment(transaction, input.paymentId);
    const payment = await transaction.payment.findUnique({
      where: { id: input.paymentId },
      include: paymentDetailsInclude
    });
    if (!payment || payment.buyerId !== input.buyerId) {
      throw new PaymentWorkflowError(404, "Payment request not found");
    }
    if (payment.status !== "PENDING") {
      throw new PaymentWorkflowError(409, "Only pending payment requests can be simulated");
    }
    if (!payment.expiresAt || payment.expiresAt <= now) {
      const expired = await markPaymentExpired(transaction, payment, now);
      return { kind: "EXPIRED" as const, payment: expired, saleClosing: null };
    }
    assertPaymentContext(payment);
    if (payment.property.status !== "APPROVED") {
      throw new PaymentWorkflowError(409, "The property is no longer eligible for payment");
    }

    await auditPaymentAction(
      transaction,
      payment,
      "PAYMENT_INITIATED",
      `Simulated payment initiated; transaction reference ${payment.transactionReference}`
    );

    if (input.outcome === "FAILED") {
      const updated = await transaction.payment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          failureReason: "Simulated failure selected by the buyer"
        },
        include: paymentDetailsInclude
      });
      await auditPaymentAction(
        transaction,
        updated,
        "PAYMENT_FAILED",
        `Simulated payment failed; transaction reference ${updated.transactionReference}`
      );
      return { kind: "FAILED" as const, payment: updated, saleClosing: null };
    }

    const updated = await transaction.payment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCESS",
        paidAt: now,
        failureReason: null
      },
      include: paymentDetailsInclude
    });
    const saleClosing = await transaction.saleClosing.create({
      data: {
        auctionId: updated.auctionId,
        propertyId: updated.propertyId,
        paymentId: updated.id,
        buyerId: updated.buyerId,
        sellerId: updated.sellerId,
        status: "PENDING"
      },
      select: { id: true, status: true }
    });
    await auditPaymentAction(
      transaction,
      updated,
      "PAYMENT_SUCCEEDED",
      `Simulated payment succeeded; transaction reference ${updated.transactionReference}`
    );
    await auditPaymentAction(
      transaction,
      updated,
      "SALE_CLOSING_CREATED",
      `Sale closing pending seller confirmation; transaction reference ${updated.transactionReference}`,
      saleClosing.id
    );
    return {
      kind: "SUCCESS" as const,
      payment: updated,
      saleClosing: { id: saleClosing.id, status: "PENDING" as const }
    };
  });

  if (result.kind !== "EXPIRED") {
    broadcastPaymentEvent(
      io,
      "payment:initiated",
      { buyerId: result.payment.buyerId, sellerId: result.payment.sellerId },
      privatePaymentPayload(result.payment, result.saleClosing ?? undefined),
      adminPaymentPayload(result.payment)
    );
  }
  if (result.kind === "SUCCESS" && result.saleClosing) {
    broadcastPaymentEvent(
      io,
      "payment:succeeded",
      { buyerId: result.payment.buyerId, sellerId: result.payment.sellerId },
      privatePaymentPayload(result.payment, result.saleClosing),
      adminPaymentPayload(result.payment)
    );
    broadcastPaymentEvent(
      io,
      "sale-closing:pending",
      { buyerId: result.payment.buyerId, sellerId: result.payment.sellerId },
      privatePaymentPayload(result.payment, result.saleClosing),
      adminPaymentPayload(result.payment)
    );
  } else if (result.kind === "FAILED") {
    broadcastPaymentEvent(
      io,
      "payment:failed",
      { buyerId: result.payment.buyerId, sellerId: result.payment.sellerId },
      privatePaymentPayload(result.payment),
      adminPaymentPayload(result.payment)
    );
  } else {
    broadcastPaymentEvent(
      io,
      "payment:expired",
      { buyerId: result.payment.buyerId, sellerId: result.payment.sellerId },
      privatePaymentPayload(result.payment),
      adminPaymentPayload(result.payment)
    );
  }
  return result;
}

export async function retryPayment(
  io: Server,
  database: PaymentDatabase,
  input: { paymentId: string; buyerId: string; now?: Date }
): Promise<PaymentDetails> {
  const now = input.now ?? new Date();
  await expirePaymentIfDue(io, database, input.paymentId, now, input.buyerId);

  const payment = await database.$transaction(async (transaction) => {
    await lockPayment(transaction, input.paymentId);
    const current = await transaction.payment.findUnique({
      where: { id: input.paymentId },
      include: paymentDetailsInclude
    });
    if (!current || current.buyerId !== input.buyerId) {
      throw new PaymentWorkflowError(404, "Payment request not found");
    }
    if (current.status !== "FAILED" && current.status !== "EXPIRED") {
      throw new PaymentWorkflowError(409, "Only failed or expired payments can be retried");
    }
    assertPaymentContext(current);
    if (current.property.status !== "APPROVED" || current.saleClosing) {
      throw new PaymentWorkflowError(409, "This payment can no longer be retried");
    }

    const previousReference = current.transactionReference;
    const nextReference = createTransactionReference();
    const updated = await transaction.payment.update({
      where: { id: current.id },
      data: {
        status: "PENDING",
        transactionReference: nextReference,
        expiresAt: getPaymentExpiry(now),
        paidAt: null,
        failureReason: null,
        providerReference: null
      },
      include: paymentDetailsInclude
    });
    await auditPaymentAction(
      transaction,
      updated,
      "PAYMENT_RETRY_INITIATED",
      `Simulated payment retry initiated; previous transaction reference ${previousReference}; new transaction reference ${nextReference}`
    );
    return updated;
  });

  broadcastPaymentEvent(
    io,
    "payment:request-created",
    { buyerId: payment.buyerId, sellerId: payment.sellerId },
    privatePaymentPayload(payment),
    adminPaymentPayload(payment)
  );
  return payment;
}

