import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import type { Server } from "socket.io";
import prisma from "../config/prisma";
import { JWT_SECRET } from "../config/env";
import type { PaymentDetails } from "../services/simulated-payment.service";
import type { SaleClosingDetails } from "../services/sale-closing.service";
import { createPaymentRouter } from "./payment.routes";

const PAYMENT_ID = "c223456789012345678901234";
const AUCTION_ID = "c123456789012345678901234";
const CLOSING_ID = "c323456789012345678901234";
const PROPERTY_ID = "property-workflow";
const BUYER_ID = "buyer-workflow";
const SELLER_ID = "seller-workflow";

describe("simulated payment HTTP workflow integration", () => {
  const emitted: Array<{ room: string; event: string }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const state = {
    committed: false,
    propertyStatus: "APPROVED" as "APPROVED" | "SOLD",
    payment: null as PaymentDetails | null,
    closing: null as SaleClosingDetails | null
  };
  const now = new Date();
  state.payment = {
    id: PAYMENT_ID,
    auctionId: AUCTION_ID,
    winningBidId: "bid-workflow",
    propertyId: PROPERTY_ID,
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    amount: new Prisma.Decimal("150000.00"),
    currency: "INR",
    status: "PENDING",
    transactionReference: "SIM-PAY-integration",
    provider: "SIMULATED",
    providerReference: null,
    isSimulated: true,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    failureReason: null,
    auction: {
      id: AUCTION_ID,
      propertyId: PROPERTY_ID,
      status: "COMPLETED",
      outcomeStatus: "ACCEPTED",
      winningBidId: "bid-workflow"
    },
    property: {
      id: PROPERTY_ID,
      title: "Integration property",
      city: "Pune",
      state: "Maharashtra",
      images: [],
      status: "APPROVED",
      sellerId: SELLER_ID
    },
    winningBid: {
      id: "bid-workflow",
      amount: 150000,
      bidderId: BUYER_ID
    },
    saleClosing: null
  };

  const transaction = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes('"SaleClosing"')) {
        return state.closing ? [{ id: state.closing.id }] : [];
      }
      return state.payment ? [{ id: state.payment.id }] : [];
    },
    payment: {
      findUnique: async () => state.payment,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        assert.ok(state.payment);
        state.payment = {
          ...state.payment,
          ...data,
          updatedAt: new Date(),
          property: { ...state.payment.property, status: state.propertyStatus },
          saleClosing: state.closing ? {
            id: state.closing.id,
            status: state.closing.status,
            createdAt: state.closing.createdAt,
            completedAt: state.closing.completedAt
          } : null
        } as PaymentDetails;
        if (state.closing) state.closing.payment = state.payment;
        return state.payment;
      }
    },
    saleClosing: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        assert.ok(state.payment);
        state.closing = {
          id: CLOSING_ID,
          auctionId: String(data.auctionId),
          propertyId: String(data.propertyId),
          paymentId: String(data.paymentId),
          buyerId: String(data.buyerId),
          sellerId: String(data.sellerId),
          status: "PENDING",
          createdAt: new Date(),
          completedAt: null,
          auction: state.payment.auction,
          property: {
            ...state.payment.property,
            status: state.propertyStatus
          },
          payment: state.payment
        } as SaleClosingDetails;
        return { id: CLOSING_ID, status: "PENDING" };
      },
      findUnique: async () => state.closing,
      update: async ({ data }: { data: { status: "COMPLETED"; completedAt: Date } }) => {
        assert.ok(state.closing && state.payment);
        state.closing = {
          ...state.closing,
          status: data.status,
          completedAt: data.completedAt,
          property: { ...state.closing.property, status: state.propertyStatus },
          payment: state.payment
        };
        return state.closing;
      }
    },
    property: {
      updateMany: async ({ where, data }: {
        where: { id: string; sellerId: string; status: string };
        data: { status: "SOLD" };
      }) => {
        if (
          where.id !== PROPERTY_ID
          || where.sellerId !== SELLER_ID
          || state.propertyStatus !== where.status
        ) return { count: 0 };
        state.propertyStatus = data.status;
        if (state.closing) {
          state.closing.property = { ...state.closing.property, status: "SOLD" };
        }
        return { count: 1 };
      }
    },
    auctionAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const record = { ...data, id: `audit-${audits.length + 1}`, createdAt: new Date() };
        audits.push(record);
        return record;
      }
    }
  };

  const database = {
    ...transaction,
    $transaction: async <T>(operation: (tx: unknown) => Promise<T>): Promise<T> => {
      const result = await operation(transaction);
      state.committed = true;
      return result;
    }
  } as unknown as typeof prisma;

  const io = {
    to: (room: string) => ({
      emit: (event: string) => {
        assert.equal(state.committed, true, "Socket events must follow transaction commit");
        emitted.push({ room, event });
      }
    })
  } as unknown as Server;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/payments", createPaymentRouter(io, database));
  const server = createServer(app);

  before(async () => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  async function send(
    role: "BUYER" | "SELLER" | "ADMIN",
    subject: string,
    path: string,
    init: RequestInit = {}
  ): Promise<Response> {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const token = jwt.sign({ role }, JWT_SECRET, { subject, expiresIn: "5m" });
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(`http://127.0.0.1:${address.port}/api/v1/payments${path}`, {
      ...init,
      headers
    });
  }

  it("simulates a buyer payment and lets only the property owner complete the demo closing", async () => {
    const otherBuyer = await send("BUYER", "buyer-other", `/${PAYMENT_ID}/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "SUCCESS" })
    });
    const adminAttempt = await send("ADMIN", "admin-workflow", `/${PAYMENT_ID}/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "SUCCESS" })
    });
    assert.equal(otherBuyer.status, 404);
    assert.equal(adminAttempt.status, 403);
    assert.equal(state.payment?.status, "PENDING");

    const success = await send("BUYER", BUYER_ID, `/${PAYMENT_ID}/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "SUCCESS" })
    });
    assert.equal(success.status, 200);
    const successBody = await success.json() as {
      payment: { status: string };
      saleClosing: { id: string; status: string };
      paymentMode: string;
      isRealPayment: boolean;
    };
    assert.equal(successBody.payment.status, "SUCCESS");
    assert.deepEqual(successBody.saleClosing, { id: CLOSING_ID, status: "PENDING" });
    assert.equal(successBody.paymentMode, "SIMULATED");
    assert.equal(successBody.isRealPayment, false);
    assert.equal(state.propertyStatus, "APPROVED");

    const repeated = await send("BUYER", BUYER_ID, `/${PAYMENT_ID}/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "SUCCESS" })
    });
    const otherSeller = await send("SELLER", "seller-other", `/seller/closings/${CLOSING_ID}/confirm`, {
      method: "POST"
    });
    const buyerClosing = await send("BUYER", BUYER_ID, `/seller/closings/${CLOSING_ID}/confirm`, {
      method: "POST"
    });
    assert.equal(repeated.status, 409);
    assert.equal(otherSeller.status, 403);
    assert.equal(buyerClosing.status, 403);

    const confirmed = await send("SELLER", SELLER_ID, `/seller/closings/${CLOSING_ID}/confirm`, {
      method: "POST"
    });
    assert.equal(confirmed.status, 200);
    const closingBody = await confirmed.json() as {
      closing: { status: string; property: { status: string } };
      paymentMode: string;
      isRealPayment: boolean;
    };
    assert.equal(closingBody.closing.status, "COMPLETED");
    assert.equal(closingBody.closing.property.status, "SOLD");
    assert.equal(closingBody.paymentMode, "SIMULATED");
    assert.equal(closingBody.isRealPayment, false);
    assert.equal(state.propertyStatus, "SOLD");
    assert.ok(audits.some(({ action }) => action === "PAYMENT_SUCCEEDED"));
    assert.ok(audits.some(({ action }) => action === "SALE_CLOSING_CREATED"));
    assert.ok(audits.some(({ action }) => action === "SALE_CLOSING_COMPLETED"));
    assert.ok(emitted.some(({ event }) => event === "payment:succeeded"));
    assert.ok(emitted.some(({ event }) => event === "sale-closing:completed"));
    assert.ok(emitted.every(({ room }) => !room.startsWith("auction:")));
  });
});
