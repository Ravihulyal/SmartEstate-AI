import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import type { Response } from "express";
import type { Server } from "socket.io";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/auth.middleware";
import { createAuctionHandlers } from "./auction.controller";

const AUCTION_ID = "c123456789012345678901234";
const SELLER_ID = "seller-1";
const ADMIN_ID = "admin-1";

interface TestAuction {
  id: string;
  propertyId: string;
  startPrice: number;
  currentBid: number | null;
  startTime: Date;
  endTime: Date;
  status: "UPCOMING" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  outcomeStatus: "NO_BIDS" | "PENDING_SELLER_APPROVAL" | "ACCEPTED" | "REJECTED" | null;
  winningBidId: string | null;
  sellerDecisionAt: Date | null;
  sellerDecisionReason: string | null;
  createdAt: Date;
  property: { sellerId: string; status: "APPROVED" | "PENDING" };
}

interface TestBid {
  id: string;
  amount: number;
  createdAt: Date;
  bidderId: string;
  bidderName?: string;
}

interface TestAudit {
  id: string;
  auctionId: string;
  adminId: string | null;
  sellerId: string | null;
  buyerId: string | null;
  paymentId: string | null;
  action: string;
  reason: string | null;
  createdAt: Date;
}

interface TestResponse {
  statusCode: number;
  body: unknown;
}

interface ResponseBuilder {
  status(code: number): ResponseBuilder;
  json(body: unknown): ResponseBuilder;
}

function makeHarness(
  status: TestAuction["status"],
  ownerId = SELLER_ID,
  startOffsetMs = status === "ACTIVE" ? -60_000 : 60 * 60_000,
  endOffsetMs = status === "ACTIVE" ? 60 * 60_000 : 2 * 60 * 60_000,
  initialBids: TestBid[] = []
) {
  const now = Date.now();
  const state = {
    auction: {
      id: AUCTION_ID,
      propertyId: "property-1",
      startPrice: 100_000,
      currentBid: initialBids.length
        ? Math.max(...initialBids.map((bid) => bid.amount))
        : null,
      startTime: new Date(now + startOffsetMs),
      endTime: new Date(now + endOffsetMs),
      status,
      outcomeStatus: status === "COMPLETED"
        ? initialBids.length ? "PENDING_SELLER_APPROVAL" : "NO_BIDS"
        : null,
      winningBidId: initialBids.length
        ? [...initialBids].sort((a, b) => b.amount - a.amount || a.createdAt.getTime() - b.createdAt.getTime())[0].id
        : null,
      sellerDecisionAt: null,
      sellerDecisionReason: null,
      createdAt: new Date(now - 86_400_000),
      property: { sellerId: ownerId, status: "APPROVED" as const }
    } satisfies TestAuction,
    bids: [...initialBids],
    audits: [] as TestAudit[],
    payments: [] as Array<Record<string, unknown>>,
    auditSql: [] as string[],
    rooms: [] as string[],
    lockQueries: [] as string[],
    emitted: [] as Array<{ event: string; payload: unknown }>,
    findManyArgs: [] as unknown[],
    commits: 0
  };

  let lockTail = Promise.resolve();
  async function acquireLock(): Promise<() => void> {
    const previous = lockTail;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    lockTail = previous.then(() => pending);
    await previous;
    return release;
  }

  const database = {
    auction: {
      findFirst: async () => {
        const winner = [...state.bids]
          .sort((a, b) => b.amount - a.amount || a.createdAt.getTime() - b.createdAt.getTime())[0];
        return {
          ...state.auction,
          winningBid: winner ? { amount: winner.amount, bidderId: winner.bidderId } : null,
          bids: state.bids.map(({ id, amount, createdAt }) => ({ id, amount, createdAt }))
        };
      },
      findMany: async (args: unknown) => {
        state.findManyArgs.push(args);
        const winner = [...state.bids]
          .sort((a, b) => b.amount - a.amount || a.createdAt.getTime() - b.createdAt.getTime())[0];
        return [{
          ...state.auction,
          property: { id: state.auction.propertyId, title: "Test property", images: [] },
          winningBid: winner
            ? { amount: winner.amount, bidder: { name: winner.bidderName ?? "Test buyer" } }
            : null,
          bids: state.bids.map(({ id, amount, createdAt }) => ({ id, amount, createdAt }))
        }];
      }
    },
    $transaction: async (operation: (transaction: unknown) => Promise<unknown>) => {
      let release: (() => void) | undefined;
      const transaction = {
        $queryRaw: async (strings: TemplateStringsArray) => {
          state.lockQueries.push(strings.join(" "));
          release = await acquireLock();
          return [{ id: state.auction.id }];
        },
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          state.auditSql.push(strings.join(" "));
          state.audits.push({
            id: String(values[0]),
            auctionId: String(values[1]),
            adminId: String(values[2]),
            sellerId: null,
            buyerId: null,
            paymentId: null,
            action: String(values[3]),
            reason: String(values[4]),
            createdAt: new Date()
          });
          return 1;
        },
        auction: {
          findUnique: async () => state.auction,
          update: async ({ data }: { data: Partial<TestAuction> }) => {
            Object.assign(state.auction, data);
            return state.auction;
          }
        },
        bid: {
          count: async () => state.bids.length,
          findFirst: async () => [...state.bids]
            .sort((a, b) => b.amount - a.amount || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0] ?? null,
          create: async ({ data }: { data: { amount: number; bidderId: string } }) => {
            const bid = {
              id: `bid-${state.bids.length + 1}`,
              amount: data.amount,
              bidderId: data.bidderId,
              createdAt: new Date()
            };
            state.bids.push(bid);
            return bid;
          }
        },
        payment: {
          findFirst: async () => null,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const payment = {
              id: `payment-${state.payments.length + 1}`,
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
            const audit = {
              id: `audit-${state.audits.length + 1}`,
              auctionId: String(data.auctionId),
              sellerId: typeof data.sellerId === "string" ? data.sellerId : null,
              adminId: typeof data.adminId === "string" ? data.adminId : null,
              buyerId: typeof data.buyerId === "string" ? data.buyerId : null,
              paymentId: typeof data.paymentId === "string" ? data.paymentId : null,
              action: String(data.action),
              reason: typeof data.reason === "string" ? data.reason : null,
              createdAt: new Date()
            };
            state.audits.push(audit);
            return audit;
          }
        }
      };

      try {
        const result = await operation(transaction);
        state.commits += 1;
        return result;
      } finally {
        release?.();
      }
    }
  } as unknown as typeof prisma;

  const io = {
    to: (room: string) => {
      state.rooms.push(room);
      return {
      emit: (event: string, payload: unknown) => {
        assert.ok(state.commits > 0, "Socket events must be emitted after commit");
        state.emitted.push({ event, payload });
        return true;
      }
      };
    }
  } as unknown as Server;

  return { handlers: createAuctionHandlers(io, database), state };
}

function makeRequest(
  role: "SELLER" | "ADMIN" | "BUYER",
  userId: string,
  body: unknown = {}
): AuthRequest {
  return {
    params: { id: AUCTION_ID },
    body,
    user: { id: userId, role },
    headers: {}
  } as unknown as AuthRequest;
}

function makeResponse(): { response: Response; result: TestResponse } {
  const result: TestResponse = { statusCode: 200, body: undefined };
  const response: ResponseBuilder = {
    status(code: number) {
      result.statusCode = code;
      return response;
    },
    json(body: unknown) {
      result.body = body;
      return response;
    }
  };
  return { response: response as unknown as Response, result };
}

async function invoke(
  handler: (req: AuthRequest, res: Response) => Promise<unknown>,
  request: AuthRequest
): Promise<TestResponse> {
  const { response, result } = makeResponse();
  await handler(request, response);
  return result;
}

describe("auction management handlers", () => {
  it("allows a seller to reschedule their own upcoming auction and emits after commit", async () => {
    const { handlers, state } = makeHarness("UPCOMING");
    const startTime = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const endTime = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    const result = await invoke(
      handlers.updateSchedule,
      makeRequest("SELLER", SELLER_ID, { startTime, endTime })
    );

    assert.equal(result.statusCode, 200);
    assert.equal(state.auction.startTime.toISOString(), startTime);
    assert.deepEqual(state.emitted.map(({ event }) => event), [
      "auction:schedule-updated",
      "auction:status"
    ]);
    assert.deepEqual(state.rooms, [`auction:${AUCTION_ID}`]);
    assert.match(state.lockQueries[0], /FOR UPDATE/);
  });

  it("rejects a seller editing another seller's auction and rejects live schedule edits", async () => {
    const otherOwner = makeHarness("UPCOMING", "seller-2");
    const schedule = {
      startTime: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
      endTime: new Date(Date.now() + 3 * 60 * 60_000).toISOString()
    };
    const forbidden = await invoke(
      otherOwner.handlers.updateSchedule,
      makeRequest("SELLER", SELLER_ID, schedule)
    );
    assert.equal(forbidden.statusCode, 403);

    const live = makeHarness("ACTIVE");
    const conflict = await invoke(
      live.handlers.updateSchedule,
      makeRequest("SELLER", SELLER_ID, schedule)
    );
    assert.equal(conflict.statusCode, 409);
  });

  it("validates future schedule boundaries", async () => {
    const { handlers } = makeHarness("UPCOMING");
    const invalid = await invoke(
      handlers.updateSchedule,
      makeRequest("SELLER", SELLER_ID, {
        startTime: new Date(Date.now() - 60_000).toISOString(),
        endTime: new Date(Date.now() + 60_000).toISOString()
      })
    );
    assert.equal(invalid.statusCode, 400);

    const reversed = await invoke(
      handlers.updateSchedule,
      makeRequest("ADMIN", ADMIN_ID, {
        startTime: new Date(Date.now() + 2 * 60_000).toISOString(),
        endTime: new Date(Date.now() + 60_000).toISOString()
      })
    );
    assert.equal(reversed.statusCode, 400);
  });

  it("lets a seller cancel their own upcoming auction and preserves bids", async () => {
    const priorBid = {
      id: "existing-bid",
      amount: 105_000,
      createdAt: new Date(),
      bidderId: "buyer-1"
    };
    const { handlers, state } = makeHarness("UPCOMING", SELLER_ID, 60 * 60_000, 2 * 60 * 60_000, [priorBid]);
    const result = await invoke(
      handlers.cancelAuction,
      makeRequest("SELLER", SELLER_ID)
    );
    assert.equal(result.statusCode, 409);
    assert.equal(state.bids.length, 1);
    assert.notEqual(state.auction.status, "CANCELLED");

    const noBids = makeHarness("UPCOMING");
    const cancelled = await invoke(
      noBids.handlers.cancelAuction,
      makeRequest("SELLER", SELLER_ID)
    );
    assert.equal(cancelled.statusCode, 200);
    assert.equal(noBids.state.auction.status, "CANCELLED");
    assert.deepEqual(noBids.state.emitted.map(({ event }) => event), [
      "auction:cancelled",
      "auction:status"
    ]);
  });

  it("rejects seller cancellation of another seller's auction and a scanner-late live auction", async () => {
    const otherOwner = makeHarness("UPCOMING", "seller-2");
    const forbidden = await invoke(
      otherOwner.handlers.cancelAuction,
      makeRequest("SELLER", SELLER_ID)
    );
    assert.equal(forbidden.statusCode, 403);

    const scannerLate = makeHarness("UPCOMING", SELLER_ID, -60_000, 60 * 60_000);
    const rejected = await invoke(
      scannerLate.handlers.cancelAuction,
      makeRequest("SELLER", SELLER_ID)
    );
    assert.equal(rejected.statusCode, 409);
    assert.equal(scannerLate.state.auction.status, "UPCOMING");
  });

  it("requires admin reasons, audits live cancellation, and rejects repeated cancellation", async () => {
    const priorBid = {
      id: "existing-bid",
      amount: 105_000,
      createdAt: new Date(),
      bidderId: "buyer-1"
    };
    const { handlers, state } = makeHarness(
      "ACTIVE",
      SELLER_ID,
      -60_000,
      60 * 60_000,
      [priorBid]
    );
    const missingReason = await invoke(
      handlers.cancelAuction,
      makeRequest("ADMIN", ADMIN_ID)
    );
    assert.equal(missingReason.statusCode, 400);
    assert.equal(state.commits, 0);

    const cancelled = await invoke(
      handlers.cancelAuction,
      makeRequest("ADMIN", ADMIN_ID, { reason: "Regulatory review" })
    );
    assert.equal(cancelled.statusCode, 200);
    assert.equal(state.auction.status, "CANCELLED");
    assert.deepEqual(state.audits.map(({ action, reason, adminId }) => ({ action, reason, adminId })), [
      { action: "CANCELLED", reason: "Regulatory review", adminId: ADMIN_ID }
    ]);
    assert.ok(state.audits[0].createdAt instanceof Date);
    assert.match(state.auditSql[0], /CURRENT_TIMESTAMP/);
    assert.equal(state.bids.length, 1);
    assert.equal(state.bids[0].id, priorBid.id);
    assert.equal("bidderId" in (state.emitted[0].payload as object), false);
    assert.deepEqual(state.rooms, [`auction:${AUCTION_ID}`]);
    assert.deepEqual(state.emitted.map(({ event }) => event), [
      "auction:cancelled",
      "auction:status"
    ]);
    assert.deepEqual(state.rooms, [`auction:${AUCTION_ID}`]);

    const repeated = await invoke(
      handlers.cancelAuction,
      makeRequest("ADMIN", ADMIN_ID, { reason: "Duplicate request" })
    );
    assert.equal(repeated.statusCode, 409);
    assert.equal(state.audits.length, 1);
  });

  it("ends a live auction early with an audit record and closes bidding", async () => {
    const { handlers, state } = makeHarness("ACTIVE");
    const previousEndTime = state.auction.endTime;
    const result = await invoke(
      handlers.endAuctionEarly,
      makeRequest("ADMIN", ADMIN_ID, { reason: "Safety inspection" })
    );
    assert.equal(result.statusCode, 200);
    assert.equal(state.auction.status, "COMPLETED");
    assert.ok(state.auction.endTime < previousEndTime);
    assert.deepEqual(state.audits.map(({ action, reason }) => ({ action, reason })), [
      { action: "ENDED_EARLY", reason: "Safety inspection" }
    ]);
    assert.deepEqual(state.emitted.map(({ event }) => event), [
      "auction:ended-early",
      "auction:status",
      "auction:no-bids"
    ]);
    const repeated = await invoke(
      handlers.endAuctionEarly,
      makeRequest("ADMIN", ADMIN_ID, { reason: "Repeated closure" })
    );
    assert.equal(repeated.statusCode, 409);
    assert.equal(state.audits.length, 1);

    const invalid = makeHarness("UPCOMING");
    const noReason = await invoke(
      invalid.handlers.endAuctionEarly,
      makeRequest("ADMIN", ADMIN_ID, { reason: "no" })
    );
    assert.equal(noReason.statusCode, 400);
  });

  it("serializes concurrent admin cancellation and bids on the same auction row", async () => {
    const { handlers, state } = makeHarness("ACTIVE");
    const cancellation = invoke(
      handlers.cancelAuction,
      makeRequest("ADMIN", ADMIN_ID, { reason: "Emergency closure" })
    );
    const bid = invoke(
      handlers.placeBid,
      makeRequest("BUYER", "buyer-1", { amount: 110_000 })
    );
    const [cancelResult, bidResult] = await Promise.all([cancellation, bid]);

    assert.equal(cancelResult.statusCode, 200);
    assert.equal(bidResult.statusCode, 409);
    assert.equal(state.auction.status, "CANCELLED");
    assert.equal(state.bids.length, 0);
    assert.equal(state.lockQueries.length, 2);
    assert.ok(state.lockQueries.every((query) => /FOR UPDATE/.test(query)));
  });

  it("approves only the actual highest bid and writes a seller audit after the locked decision", async () => {
    const bids = [
      {
        id: "lower-bid",
        amount: 125_000,
        createdAt: new Date("2026-01-01T10:00:00Z"),
        bidderId: "buyer-lower"
      },
      {
        id: "highest-bid",
        amount: 150_000,
        createdAt: new Date("2026-01-01T10:05:00Z"),
        bidderId: "buyer-winner"
      }
    ];
    const { handlers, state } = makeHarness(
      "COMPLETED",
      SELLER_ID,
      -2 * 60 * 60_000,
      -60_000,
      bids
    );
    const result = await invoke(
      handlers.approveWinner,
      makeRequest("SELLER", SELLER_ID)
    );

    assert.equal(result.statusCode, 200);
    assert.equal(state.auction.outcomeStatus, "ACCEPTED");
    assert.equal(state.auction.winningBidId, "highest-bid");
    assert.equal(state.bids.length, 2);
    assert.deepEqual(
      state.audits.map(({ action, reason, adminId, sellerId, buyerId }) => ({
        action, reason, adminId, sellerId, buyerId
      })),
      [{
        action: "WINNER_APPROVED",
        reason: null,
        adminId: null,
        sellerId: SELLER_ID,
        buyerId: null
      }, {
        action: "PAYMENT_CREATED",
        reason: state.audits[1].reason,
        adminId: null,
        sellerId: SELLER_ID,
        buyerId: "buyer-winner"
      }]
    );
    assert.equal(state.payments.length, 1);
    assert.deepEqual(state.emitted.map(({ event }) => event), [
      "auction:winner-approved",
      "auction:winner-confirmed",
      "payment:request-created",
      "payment:request-created",
      "admin:payment-updated"
    ]);
    assert.deepEqual(state.rooms, [
      `auction:${AUCTION_ID}`,
      "user:buyer-winner",
      "user:buyer-winner",
      `user:${SELLER_ID}`,
      "admin:payment-monitoring"
    ]);
    assert.equal("bidderId" in (state.emitted[0].payload as object), false);
    assert.match(state.lockQueries[0], /FOR UPDATE/);
  });

  it("does not allow a seller to choose a different bidder or accept bids after completion", async () => {
    const bids = [{
      id: "highest-bid",
      amount: 150_000,
      createdAt: new Date(),
      bidderId: "buyer-winner"
    }];
    const pending = makeHarness(
      "COMPLETED", SELLER_ID, -2 * 60 * 60_000, -60_000, bids
    );
    const attemptedSelection = await invoke(
      pending.handlers.approveWinner,
      makeRequest("SELLER", SELLER_ID, { bidderId: "buyer-other" })
    );
    assert.equal(attemptedSelection.statusCode, 400);
    assert.equal(pending.state.commits, 0);

    const closed = await invoke(
      pending.handlers.placeBid,
      makeRequest("BUYER", "buyer-other", { amount: 160_000 })
    );
    assert.equal(closed.statusCode, 409);
    assert.equal(pending.state.bids.length, 1);
  });

  it("requires a seller rejection reason and prevents repeat or unowned decisions", async () => {
    const bids = [{
      id: "highest-bid",
      amount: 150_000,
      createdAt: new Date(),
      bidderId: "buyer-winner"
    }];
    const missingReason = makeHarness(
      "COMPLETED", SELLER_ID, -2 * 60 * 60_000, -60_000, bids
    );
    const invalid = await invoke(
      missingReason.handlers.rejectWinner,
      makeRequest("SELLER", SELLER_ID)
    );
    assert.equal(invalid.statusCode, 400);
    assert.equal(missingReason.state.commits, 0);

    const otherOwner = makeHarness(
      "COMPLETED", "seller-2", -2 * 60 * 60_000, -60_000, bids
    );
    const forbidden = await invoke(
      otherOwner.handlers.rejectWinner,
      makeRequest("SELLER", SELLER_ID, { reason: "Seller declines offer" })
    );
    assert.equal(forbidden.statusCode, 403);
    assert.equal(otherOwner.state.audits.length, 0);

    const { handlers, state } = makeHarness(
      "COMPLETED", SELLER_ID, -2 * 60 * 60_000, -60_000, bids
    );
    const rejected = await invoke(
      handlers.rejectWinner,
      makeRequest("SELLER", SELLER_ID, { reason: "Offer terms declined" })
    );
    assert.equal(rejected.statusCode, 200);
    assert.equal(state.auction.outcomeStatus, "REJECTED");
    assert.equal(state.auction.sellerDecisionReason, "Offer terms declined");
    assert.equal(state.auction.status, "COMPLETED");
    assert.equal(state.auction.property.status, "APPROVED");
    assert.equal(state.bids.length, 1);
    assert.deepEqual(state.emitted.map(({ event }) => event), ["auction:winner-rejected"]);

    const repeated = await invoke(
      handlers.approveWinner,
      makeRequest("SELLER", SELLER_ID)
    );
    assert.equal(repeated.statusCode, 409);
    assert.equal(state.audits.length, 1);
  });

  it("rejects decisions without bids or without a pending approval outcome", async () => {
    const noBids = makeHarness("COMPLETED", SELLER_ID, -2 * 60 * 60_000, -60_000);
    noBids.state.auction.outcomeStatus = "PENDING_SELLER_APPROVAL";
    const noBidResult = await invoke(
      noBids.handlers.approveWinner,
      makeRequest("SELLER", SELLER_ID)
    );
    assert.equal(noBidResult.statusCode, 409);
    assert.equal(noBids.state.audits.length, 0);

    const noLongerPending = makeHarness(
      "COMPLETED",
      SELLER_ID,
      -2 * 60 * 60_000,
      -60_000,
      [{
        id: "highest-bid",
        amount: 150_000,
        createdAt: new Date(),
        bidderId: "buyer-winner"
      }]
    );
    noLongerPending.state.auction.outcomeStatus = "NO_BIDS";
    const conflict = await invoke(
      noLongerPending.handlers.approveWinner,
      makeRequest("SELLER", SELLER_ID)
    );
    assert.equal(conflict.statusCode, 409);
  });

  it("lists pending approvals only for the authenticated seller without exposing bidder IDs", async () => {
    const { handlers, state } = makeHarness(
      "COMPLETED",
      SELLER_ID,
      -2 * 60 * 60_000,
      -60_000,
      [{
        id: "highest-bid",
        amount: 150_000,
        createdAt: new Date(),
        bidderId: "private-bidder-id",
        bidderName: "Buyer Name"
      }]
    );
    const result = await invoke(
      handlers.getPendingSellerApprovals,
      makeRequest("SELLER", SELLER_ID)
    );

    assert.equal(result.statusCode, 200);
    const body = result.body as {
      auctions: Array<{
        winningBid: { amount: number; bidderName: string };
        bids: Array<Record<string, unknown>>;
      }>;
    };
    assert.equal(body.auctions[0].winningBid.amount, 150_000);
    assert.equal(body.auctions[0].winningBid.bidderName, "Buyer Name");
    assert.equal("bidderId" in body.auctions[0].bids[0], false);
    const args = state.findManyArgs[0] as { where: { property: { sellerId: string } } };
    assert.equal(args.where.property.sellerId, SELLER_ID);
  });

  it("identifies the confirmed bidder without returning bidder IDs publicly", async () => {
    const { handlers } = makeHarness(
      "COMPLETED",
      SELLER_ID,
      -2 * 60 * 60_000,
      -60_000,
      [{
        id: "highest-bid",
        amount: 150_000,
        createdAt: new Date(),
        bidderId: "buyer-winner"
      }]
    );
    const winnerResult = await invoke(
      handlers.getAuction,
      makeRequest("BUYER", "buyer-winner")
    );
    const winnerBody = winnerResult.body as {
      auction: {
        isWinningBidder: boolean;
        winningBid: { amount: number };
        bids: Array<Record<string, unknown>>;
      };
    };
    assert.equal(winnerBody.auction.isWinningBidder, true);
    assert.equal(winnerBody.auction.winningBid.amount, 150_000);
    assert.equal("bidderId" in winnerBody.auction, false);
    assert.equal("bidderId" in winnerBody.auction.bids[0], false);
  });

  it("serializes concurrent seller approval and rejection requests", async () => {
    const { handlers, state } = makeHarness(
      "COMPLETED",
      SELLER_ID,
      -2 * 60 * 60_000,
      -60_000,
      [{
        id: "highest-bid",
        amount: 150_000,
        createdAt: new Date(),
        bidderId: "buyer-winner"
      }]
    );
    const [approved, rejected] = await Promise.all([
      invoke(handlers.approveWinner, makeRequest("SELLER", SELLER_ID)),
      invoke(
        handlers.rejectWinner,
        makeRequest("SELLER", SELLER_ID, { reason: "Offer terms declined" })
      )
    ]);

    assert.deepEqual(
      [approved.statusCode, rejected.statusCode].sort(),
      [200, 409]
    );
    assert.equal(
      state.audits.filter(({ action }) => action === "WINNER_APPROVED" || action === "WINNER_REJECTED").length,
      1
    );
    assert.equal(
      state.payments.length,
      state.audits.some(({ action }) => action === "PAYMENT_CREATED") ? 1 : 0
    );
    assert.equal(state.lockQueries.length, 2);
    assert.ok(state.lockQueries.every((query) => /FOR UPDATE/.test(query)));
  });

  it("uses the highest persisted bid when an administrator ends an auction early", async () => {
    const { handlers, state } = makeHarness("ACTIVE", SELLER_ID, -60_000, 60 * 60_000, [
      {
        id: "lower-bid",
        amount: 125_000,
        createdAt: new Date("2026-01-01T10:00:00Z"),
        bidderId: "buyer-lower"
      },
      {
        id: "highest-bid",
        amount: 150_000,
        createdAt: new Date("2026-01-01T10:05:00Z"),
        bidderId: "buyer-winner"
      }
    ]);
    const result = await invoke(
      handlers.endAuctionEarly,
      makeRequest("ADMIN", ADMIN_ID, { reason: "Safety inspection" })
    );

    assert.equal(result.statusCode, 200);
    assert.equal(state.auction.status, "COMPLETED");
    assert.equal(state.auction.outcomeStatus, "PENDING_SELLER_APPROVAL");
    assert.equal(state.auction.winningBidId, "highest-bid");
    assert.equal(state.bids.length, 2);
    assert.deepEqual(state.emitted.map(({ event }) => event), [
      "auction:ended-early",
      "auction:status",
      "auction:awaiting-seller-approval"
    ]);
  });

  it("keeps completed auction details and bid history available after a seller-confirmed sale", async () => {
    const soldAt = new Date();
    const auctionQueries: Array<Record<string, unknown>> = [];
    const auctionRecord = {
      id: AUCTION_ID,
      propertyId: "property-sold",
      startPrice: 100_000,
      currentBid: 125_000,
      startTime: new Date(soldAt.getTime() - 3_600_000),
      endTime: new Date(soldAt.getTime() - 1_800_000),
      status: "COMPLETED" as const,
      outcomeStatus: "ACCEPTED" as const,
      winningBidId: "bid-sold",
      sellerDecisionAt: soldAt,
      sellerDecisionReason: null,
      createdAt: new Date(soldAt.getTime() - 86_400_000),
      property: {
        id: "property-sold",
        title: "Sold test property",
        city: "Bengaluru",
        state: "Karnataka",
        location: "Whitefield",
        propertyType: "HOUSE",
        listingType: "SALE",
        price: 100_000,
        rentPerMonth: null,
        images: []
      },
      winningBid: { amount: 125_000, bidderId: "buyer-sold" },
      bids: [{ id: "bid-sold", amount: 125_000, createdAt: soldAt }]
    };
    const database = {
      auction: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          auctionQueries.push(args.where);
          return auctionRecord;
        }
      },
      bid: {
        findMany: async () => auctionRecord.bids
      }
    } as unknown as typeof prisma;
    const io = { to: () => ({ emit: () => undefined }) } as unknown as Server;
    const handlers = createAuctionHandlers(io, database);

    const detail = await invoke(
      handlers.getAuction,
      makeRequest("BUYER", "buyer-sold")
    );
    const history = await invoke(
      handlers.getBids,
      makeRequest("BUYER", "buyer-sold")
    );

    assert.equal(detail.statusCode, 200);
    assert.equal(history.statusCode, 200);
    const detailBody = detail.body as {
      auction: { status: string; winningBid: { amount: number } };
    };
    const historyBody = history.body as {
      bids: Array<{ id: string; amount: number }>;
    };
    assert.equal(detailBody.auction.status, "COMPLETED");
    assert.deepEqual(detailBody.auction.winningBid, { amount: 125_000 });
    assert.equal(JSON.stringify(detail.body).includes("buyer-sold"), false);
    assert.equal(historyBody.bids.length, 1);
    assert.equal("bidderId" in historyBody.bids[0], false);
    assert.deepEqual(auctionQueries, [
      {
        id: AUCTION_ID,
        OR: [
          { property: { status: "APPROVED" } },
          { status: "COMPLETED", property: { status: "SOLD" } }
        ]
      },
      {
        id: AUCTION_ID,
        OR: [
          { property: { status: "APPROVED" } },
          { status: "COMPLETED", property: { status: "SOLD" } }
        ]
      }
    ]);
  });
});
