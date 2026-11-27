import prisma from "../config/prisma";
import {
  broadcastAuctionAwaitingSellerApproval,
  broadcastAuctionNoBids,
  broadcastAuctionStatus
} from "./auction-socket.service";
import { completeAuction } from "./auction-outcome.service";

const STATUS_SCAN_INTERVAL_MS = 5_000;

export async function scanAuctionStatuses(
  io: Parameters<typeof broadcastAuctionStatus>[0],
  database: typeof prisma = prisma,
  now = new Date()
): Promise<void> {
  const auctions = await database.auction.findMany({
    where: {
      status: { in: ["UPCOMING", "ACTIVE"] },
      OR: [
        { status: "UPCOMING", startTime: { lte: now }, endTime: { gt: now } },
        { endTime: { lte: now } }
      ]
    },
    select: { id: true }
  });

  for (const candidate of auctions) {
    const outcome = await database.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Auction" WHERE "id" = ${candidate.id} FOR UPDATE
      `;
      if (locked.length === 0) return null;

      const current = await transaction.auction.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          status: true,
          startTime: true,
          endTime: true,
          currentBid: true
        }
      });
      if (!current || current.status === "CANCELLED" || current.status === "COMPLETED") {
        return null;
      }

      if (current.endTime <= now) {
        const completed = await completeAuction(transaction, current.id);
        return {
          kind: "completed" as const,
          auction: completed.auction,
          winningBid: completed.winningBid
        };
      }

      if (current.status === "UPCOMING" && current.startTime <= now) {
        const auction = await transaction.auction.update({
          where: { id: current.id },
          data: { status: "ACTIVE" }
        });
        return { kind: "active" as const, auction };
      }

      return null;
    });

    if (!outcome) continue;

    const auction = outcome.auction;
    const statusPayload = {
      auctionId: auction.id,
      status: outcome.kind === "completed" ? "COMPLETED" as const : "ACTIVE" as const,
      startTime: auction.startTime.toISOString(),
      endTime: auction.endTime.toISOString(),
      currentBid: auction.currentBid
    };
    broadcastAuctionStatus(io, statusPayload);

    if (outcome.kind === "completed") {
      const payload = {
        auctionId: auction.id,
        status: "COMPLETED" as const,
        outcomeStatus: outcome.winningBid ? "PENDING_SELLER_APPROVAL" as const : "NO_BIDS" as const,
        winningBidAmount: outcome.winningBid?.amount ?? null,
        endTime: auction.endTime.toISOString()
      };
      if (outcome.winningBid) {
        broadcastAuctionAwaitingSellerApproval(io, payload);
      } else {
        broadcastAuctionNoBids(io, payload);
      }
    }
  }
}

export function startAuctionStatusBroadcasts(
  io: Parameters<typeof broadcastAuctionStatus>[0],
  database: typeof prisma = prisma
): () => void {
  let stopped = false;
  let scanInProgress = false;

  const scan = async () => {
    if (stopped || scanInProgress) return;
    scanInProgress = true;

    try {
      await scanAuctionStatuses(io, database);
    } catch (error) {
      console.error("Auction status broadcast scan error:", error);
    } finally {
      scanInProgress = false;
    }
  };

  void scan();
  const interval = setInterval(() => void scan(), STATUS_SCAN_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}
