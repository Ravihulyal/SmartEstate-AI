import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, describe, it } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import type { Server } from "socket.io";
import prismaClient from "../config/prisma";
import { JWT_SECRET } from "../config/env";
import { createAuctionRouter } from "./auction.routes";

const AUCTION_ID = "c123456789012345678901234";
const SELLER_ID = "seller-1";
const WINNER_ID = "buyer-1";

describe("auction winner approval HTTP integration", () => {
  const auction = {
    id: AUCTION_ID,
    propertyId: "property-1",
    startPrice: 100_000,
    currentBid: 150_000,
    startTime: new Date("2026-11-25T10:00:00Z"),
    endTime: new Date("2026-11-26T10:00:00Z"),
    status: "COMPLETED" as const,
    outcomeStatus: "PENDING_SELLER_APPROVAL" as const,
    winningBidId: "bid-1",
    sellerDecisionAt: null as Date | null,
    sellerDecisionReason: null as string | null,
    createdAt: new Date("2026-11-24T10:00:00Z"),
    property: {
      id: "property-1",
      title: "Garden home",
      city: "Bengaluru",
      state: "Karnataka",
      location: "Green Park",
      propertyType: "HOUSE",
      listingType: "SALE",
      price: 100_000,
      rentPerMonth: null,
      images: ["https://example.test/garden.jpg"],
      sellerId: SELLER_ID,
      status: "APPROVED" as const
    }
  };
  const winningBid = {
    id: "bid-1",
    amount: 150_000,
    bidderId: WINNER_ID,
    createdAt: new Date("2026-11-26T09:00:00Z"),
    bidder: { name: "Buyer Name" }
  };
  const state = {
    committed: false,
    audits: [] as Array<Record<string, unknown>>,
    payments: [] as Array<Record<string, unknown>>,
    events: [] as Array<{ room: string; event: string; payload: Record<string, unknown> }>
  };

  const database = {
    auction: {
      findMany: async () => auction.outcomeStatus === "PENDING_SELLER_APPROVAL"
        ? [{
            id: auction.id,
            startTime: auction.startTime,
            endTime: auction.endTime,
            outcomeStatus: auction.outcomeStatus,
            winningBid: {
              amount: winningBid.amount,
              bidder: { name: winningBid.bidder.name }
            },
            bids: [{ id: winningBid.id, amount: winningBid.amount, createdAt: winningBid.createdAt }],
            property: {
              id: auction.property.id,
              title: auction.property.title,
              images: auction.property.images
            }
          }]
        : []
    },
    $transaction: async (operation: (transaction: unknown) => Promise<unknown>) => {
      const transaction = {
        $queryRaw: async () => [{ id: auction.id }],
        auction: {
          findUnique: async () => auction,
          update: async ({ data }: { data: Partial<typeof auction> }) => {
            Object.assign(auction, data);
            return {
              ...auction,
              winningBid: { amount: winningBid.amount },
              property: {
                id: auction.property.id,
                title: auction.property.title,
                city: auction.property.city,
                state: auction.property.state,
                location: auction.property.location,
                propertyType: auction.property.propertyType,
                listingType: auction.property.listingType,
                price: auction.property.price,
                rentPerMonth: auction.property.rentPerMonth,
                images: auction.property.images
              }
            };
          }
        },
        bid: { findFirst: async () => winningBid },
        payment: {
          findFirst: async () => null,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const payment = {
              id: `c223456789012345678901234`,
              ...data,
              amount: data.amount as Prisma.Decimal,
              createdAt: new Date(),
              updatedAt: new Date(),
              paidAt: null,
              failureReason: null
            };
            state.payments.push(payment);
            return payment;
          }
        },
        auctionAuditLog: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const record = { ...data, id: "audit-1", createdAt: new Date() };
            state.audits.push(record);
            return record;
          }
        }
      };
      const result = await operation(transaction);
      state.committed = true;
      return result;
    }
  } as unknown as typeof prismaClient;

  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: Record<string, unknown>) => {
        assert.equal(state.committed, true, "Socket events must be emitted after transaction commit");
        state.events.push({ room, event, payload });
      }
    })
  } as unknown as Server;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auctions", createAuctionRouter(io, database));
  const server = app.listen(0, "127.0.0.1");

  before(async () => {
    await once(server, "listening");
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("serves the seller's pending approval, accepts it, writes audit, and broadcasts safely", async () => {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/v1/auctions`;
    const sellerToken = jwt.sign(
      { role: "SELLER" },
      JWT_SECRET,
      { subject: SELLER_ID, expiresIn: "5m" }
    );
    const headers = { Authorization: `Bearer ${sellerToken}` };

    const pendingResponse = await fetch(`${base}/seller/pending-approval`, { headers });
    assert.equal(pendingResponse.status, 200);
    const pendingBody = await pendingResponse.json() as {
      count: number;
      auctions: Array<{ winningBid: { amount: number; bidderName: string } }>;
    };
    assert.equal(pendingBody.count, 1);
    assert.deepEqual(pendingBody.auctions[0].winningBid, {
      amount: 150_000,
      bidderName: "Buyer Name"
    });

    const acceptedResponse = await fetch(`${base}/${AUCTION_ID}/approve-winner`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Seller accepted terms" })
    });
    assert.equal(acceptedResponse.status, 200);
    const acceptedBody = await acceptedResponse.json() as {
      auction: { status: string; outcomeStatus: string; winningBid: { amount: number } };
      paymentRequest: { status: string; paymentMode: string; isRealPayment: boolean };
    };
    assert.equal(acceptedBody.auction.status, "COMPLETED");
    assert.equal(acceptedBody.auction.outcomeStatus, "ACCEPTED");
    assert.equal(acceptedBody.auction.winningBid.amount, 150_000);
    assert.equal(acceptedBody.paymentRequest.status, "PENDING");
    assert.equal(acceptedBody.paymentRequest.paymentMode, "SIMULATED");
    assert.equal(acceptedBody.paymentRequest.isRealPayment, false);
    assert.equal(auction.property.status, "APPROVED");
    assert.equal(state.audits.length, 2);
    assert.deepEqual({
      sellerId: state.audits[0].sellerId,
      action: state.audits[0].action,
      reason: state.audits[0].reason
    }, {
      sellerId: SELLER_ID,
      action: "WINNER_APPROVED",
      reason: "Seller accepted terms"
    });
    assert.equal(state.audits[1].action, "PAYMENT_CREATED");
    assert.equal(state.audits[1].buyerId, WINNER_ID);
    assert.equal(state.payments.length, 1);
    assert.deepEqual(state.events.map(({ event }) => event), [
      "auction:winner-approved",
      "auction:winner-confirmed",
      "payment:request-created",
      "payment:request-created",
      "admin:payment-updated"
    ]);
    assert.ok(state.events.every(({ payload }) => !("bidderId" in payload)));
    assert.equal(state.events[1].room, `user:${WINNER_ID}`);

    const noLongerPending = await fetch(`${base}/seller/pending-approval`, { headers });
    assert.equal(noLongerPending.status, 200);
    assert.deepEqual(await noLongerPending.json(), { count: 0, auctions: [] });
  });
});
