import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import type { RequestHandler } from "express";
import type { Server } from "socket.io";
import { JWT_SECRET } from "../config/env";
import prisma from "../config/prisma";
import { createPaymentRouter } from "./payment.routes";

const noOpLimiter: RequestHandler = (_req, _res, next) => next();
const PAYMENT_ID = "c223456789012345678901234";

function createTestDatabase(includeOwnedPayment = false): typeof prisma {
  const payment = {
    id: PAYMENT_ID,
    auctionId: "c123456789012345678901234",
    propertyId: "property-test",
    winningBidId: "bid-test",
    buyerId: "buyer-test",
    sellerId: "seller-test",
    amount: new Prisma.Decimal("150000.00"),
    currency: "INR",
    status: "SUCCESS",
    transactionReference: "SIM-PAY-test",
    provider: "SIMULATED",
    providerReference: null,
    isSimulated: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    paidAt: new Date("2026-01-01T00:00:00Z"),
    expiresAt: new Date("2026-01-02T00:00:00Z"),
    failureReason: null,
    auction: { status: "COMPLETED", outcomeStatus: "ACCEPTED" },
    property: {
      id: "property-test",
      title: "Test property",
      city: "Pune",
      state: "Maharashtra",
      images: []
    },
    winningBid: { id: "bid-test", amount: 150000, bidderId: "buyer-test" },
    saleClosing: null
  };
  return {
    payment: {
      findMany: async () => [],
      findFirst: async ({ where, select }: {
        where: { id: string; buyerId: string };
        select?: { id: boolean };
      }) => {
        if (
          !includeOwnedPayment
          || where.id !== PAYMENT_ID
          || where.buyerId !== payment.buyerId
        ) return null;
        return select ? { id: payment.id } : payment;
      }
    },
    saleClosing: { findMany: async () => [] },
    auctionAuditLog: { findMany: async () => [] },
    $transaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation({
      $queryRaw: async () => [{ id: PAYMENT_ID }],
      payment: { findUnique: async () => payment }
    })
  } as unknown as typeof prisma;
}

async function requestAs(
  role: "BUYER" | "SELLER" | "ADMIN" | null,
  path: string,
  init: RequestInit = {},
  database = createTestDatabase(),
  userId = role ? `${role.toLowerCase()}-test` : "anonymous"
): Promise<Response> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/payments",
    createPaymentRouter(
      {} as Server,
      database,
      noOpLimiter
    )
  );
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const headers = new Headers(init.headers);
    if (role) {
      headers.set(
        "authorization",
        `Bearer ${jwt.sign({ role }, JWT_SECRET, { subject: userId, expiresIn: "5m" })}`
      );
    }
    return await fetch(`http://127.0.0.1:${address.port}/api/v1/payments${path}`, {
      ...init,
      headers
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe("payment API authentication and role boundaries", () => {
  it("requires authentication and scopes buyer history to BUYER", async () => {
    const anonymous = await requestAs(null, "/mine/history");
    const seller = await requestAs("SELLER", "/mine/history");
    const buyer = await requestAs("BUYER", "/mine/history");

    assert.equal(anonymous.status, 401);
    assert.equal(seller.status, 403);
    assert.equal(buyer.status, 200);
  });

  it("allows the winning buyer to read an owned payment and hides it from other buyers", async () => {
    const database = createTestDatabase(true);
    const owner = await requestAs("BUYER", `/${PAYMENT_ID}`, {}, database, "buyer-test");
    const otherBuyer = await requestAs("BUYER", `/${PAYMENT_ID}`, {}, database, "buyer-other");

    assert.equal(owner.status, 200);
    const body = await owner.json() as {
      payment: { id: string };
      paymentMode: string;
      isRealPayment: boolean;
    };
    assert.equal(body.payment.id, PAYMENT_ID);
    assert.equal(body.paymentMode, "SIMULATED");
    assert.equal(body.isRealPayment, false);
    assert.equal(otherBuyer.status, 404);
  });

  it("allows read-only admin monitoring only to ADMIN", async () => {
    const seller = await requestAs("SELLER", "/admin/all");
    const admin = await requestAs("ADMIN", "/admin/all");
    const audit = await requestAs("ADMIN", "/admin/audit");

    assert.equal(seller.status, 403);
    assert.equal(admin.status, 200);
    assert.equal(audit.status, 200);
    const body = await admin.json() as { paymentMode: string; isRealPayment: boolean };
    assert.equal(body.paymentMode, "SIMULATED");
    assert.equal(body.isRealPayment, false);
  });

  it("rejects privileged role misuse and invalid request payloads", async () => {
    const buyerClosing = await requestAs("BUYER", "/seller/closings/c123456789012345678901234/confirm", {
      method: "POST"
    });
    const adminSimulation = await requestAs("ADMIN", "/c123456789012345678901234/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "SUCCESS" })
    });
    const invalidSimulation = await requestAs("BUYER", "/not-a-cuid/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "SUCCESS" })
    });
    const invalidHistory = await requestAs("BUYER", "/mine/history?page=0");

    assert.equal(buyerClosing.status, 403);
    assert.equal(adminSimulation.status, 403);
    assert.equal(invalidSimulation.status, 400);
    assert.equal(invalidHistory.status, 400);
  });
});
