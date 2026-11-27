import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Server } from "socket.io";
import prisma from "../config/prisma";
import { scanAuctionStatuses } from "./auction-status.service";

interface FakeBid {
  id: string;
  amount: number;
  bidderId: string;
  createdAt: Date;
}

function makeDatabase(bids: FakeBid[]) {
  const now = new Date("2026-11-26T17:00:00.000Z");
  const auction = {
    id: "c123456789012345678901234",
    status: "ACTIVE" as const,
    startTime: new Date(now.getTime() - 3_600_000),
    endTime: new Date(now.getTime() - 1_000),
    currentBid: bids.length ? Math.max(...bids.map((bid) => bid.amount)) : null,
    outcomeStatus: null as string | null,
    winningBidId: null as string | null,
    sellerDecisionAt: null as Date | null,
    sellerDecisionReason: null as string | null
  };
  let commits = 0;
  const database = {
    auction: {
      findMany: async () => [{ id: auction.id }]
    },
    $transaction: async (operation: (transaction: unknown) => Promise<unknown>) => {
      const transaction = {
        $queryRaw: async () => [{ id: auction.id }],
        auction: {
          findUnique: async () => auction,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            Object.assign(auction, data);
            return auction;
          }
        },
        bid: {
          findFirst: async () => [...bids].sort(
            (left, right) =>
              right.amount - left.amount ||
              left.createdAt.getTime() - right.createdAt.getTime() ||
              left.id.localeCompare(right.id)
          )[0] ?? null
        }
      };
      const result = await operation(transaction);
      commits += 1;
      return result;
    }
  } as unknown as typeof prisma;
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const io = {
    to: () => ({
      emit: (event: string, payload: unknown) => {
        assert.ok(commits > 0, "Outcome events must be sent after commit");
        emitted.push({ event, payload });
      }
    })
  } as unknown as Server;

  return { now, auction, database, emitted, io };
}

describe("scheduled auction completion", () => {
  it("marks an ended auction with no bids as NO_BIDS", async () => {
    const state = makeDatabase([]);
    await scanAuctionStatuses(state.io, state.database, state.now);

    assert.equal(state.auction.status, "COMPLETED");
    assert.equal(state.auction.outcomeStatus, "NO_BIDS");
    assert.equal(state.auction.winningBidId, null);
    assert.deepEqual(state.emitted.map(({ event }) => event), [
      "auction:status",
      "auction:no-bids"
    ]);
  });

  it("uses the highest persisted bid and awaits seller approval", async () => {
    const state = makeDatabase([
      {
        id: "lower",
        amount: 140_000,
        bidderId: "private-lower-bidder",
        createdAt: new Date("2026-11-26T16:30:00Z")
      },
      {
        id: "highest",
        amount: 175_000,
        bidderId: "private-highest-bidder",
        createdAt: new Date("2026-11-26T16:45:00Z")
      }
    ]);
    await scanAuctionStatuses(state.io, state.database, state.now);

    assert.equal(state.auction.status, "COMPLETED");
    assert.equal(state.auction.outcomeStatus, "PENDING_SELLER_APPROVAL");
    assert.equal(state.auction.winningBidId, "highest");
    assert.deepEqual(state.emitted.map(({ event }) => event), [
      "auction:status",
      "auction:awaiting-seller-approval"
    ]);
    const payload = state.emitted[1].payload as Record<string, unknown>;
    assert.equal(payload.winningBidAmount, 175_000);
    assert.equal("bidderId" in payload, false);
  });
});
