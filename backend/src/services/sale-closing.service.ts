import { Prisma } from "@prisma/client";
import type { Server } from "socket.io";
import prisma from "../config/prisma";
import { broadcastPaymentEvent } from "./payment-socket.service";
import {
  PaymentWorkflowError,
  paymentDetailsInclude
} from "./simulated-payment.service";

export const saleClosingDetailsInclude = {
  auction: {
    select: {
      id: true,
      propertyId: true,
      status: true,
      outcomeStatus: true,
      winningBidId: true
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
  payment: {
    include: paymentDetailsInclude
  }
} satisfies Prisma.SaleClosingInclude;

export type SaleClosingDetails = Prisma.SaleClosingGetPayload<{
  include: typeof saleClosingDetailsInclude;
}>;

export async function completeSaleClosing(
  io: Server,
  database: typeof prisma,
  input: { closingId: string; sellerId: string; now?: Date }
): Promise<SaleClosingDetails> {
  const now = input.now ?? new Date();
  const closing = await database.$transaction(async (transaction) => {
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "SaleClosing" WHERE "id" = ${input.closingId} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new PaymentWorkflowError(404, "Sale closing not found");
    }

    const current = await transaction.saleClosing.findUnique({
      where: { id: input.closingId },
      include: saleClosingDetailsInclude
    });
    if (!current) {
      throw new PaymentWorkflowError(404, "Sale closing not found");
    }
    if (
      current.sellerId !== input.sellerId
      || current.property.sellerId !== input.sellerId
    ) {
      throw new PaymentWorkflowError(403, "You cannot confirm another seller's closing");
    }
    if (current.status !== "PENDING") {
      throw new PaymentWorkflowError(409, "Sale closing is no longer pending");
    }

    const payment = current.payment;
    const bidAmount = new Prisma.Decimal(payment.winningBid.amount.toFixed(2));
    if (
      current.auction.status !== "COMPLETED"
      || current.auction.outcomeStatus !== "ACCEPTED"
      || current.auction.winningBidId !== payment.winningBidId
      || current.auction.propertyId !== current.propertyId
      || payment.status !== "SUCCESS"
      || payment.provider !== "SIMULATED"
      || !payment.isSimulated
      || payment.auctionId !== current.auctionId
      || payment.propertyId !== current.propertyId
      || payment.buyerId !== current.buyerId
      || payment.sellerId !== current.sellerId
      || payment.winningBidId !== payment.winningBid.id
      || payment.winningBid.bidderId !== current.buyerId
      || !payment.amount.equals(bidAmount)
    ) {
      throw new PaymentWorkflowError(409, "The accepted auction and successful simulated payment do not match this closing");
    }
    if (current.property.status !== "APPROVED") {
      throw new PaymentWorkflowError(409, "The property is no longer eligible for sale closing");
    }

    const propertyUpdate = await transaction.property.updateMany({
      where: {
        id: current.propertyId,
        sellerId: input.sellerId,
        status: "APPROVED"
      },
      data: { status: "SOLD" }
    });
    if (propertyUpdate.count !== 1) {
      throw new PaymentWorkflowError(409, "The property is no longer eligible for sale closing");
    }

    const completed = await transaction.saleClosing.update({
      where: { id: current.id },
      data: {
        status: "COMPLETED",
        completedAt: now
      },
      include: saleClosingDetailsInclude
    });
    await transaction.auctionAuditLog.create({
      data: {
        auctionId: current.auctionId,
        sellerId: input.sellerId,
        buyerId: current.buyerId,
        paymentId: payment.id,
        saleClosingId: current.id,
        action: "SALE_CLOSING_COMPLETED",
        reason: `Demo sale closing confirmed; simulated transaction reference ${payment.transactionReference}`
      }
    });
    return completed;
  });

  const payload = {
    paymentId: closing.paymentId,
    saleClosingId: closing.id,
    auctionId: closing.auctionId,
    status: closing.status,
    completedAt: closing.completedAt?.toISOString() ?? null,
    paymentMode: "SIMULATED",
    isRealPayment: false
  };
  broadcastPaymentEvent(
    io,
    "sale-closing:completed",
    { buyerId: closing.buyerId, sellerId: closing.sellerId },
    {
      ...payload,
      transactionReference: closing.payment.transactionReference,
      amount: closing.payment.amount.toFixed(2),
      currency: closing.payment.currency
    },
    {
      ...payload,
      propertyId: closing.propertyId,
      transactionReference: closing.payment.transactionReference
    }
  );
  return closing;
}
