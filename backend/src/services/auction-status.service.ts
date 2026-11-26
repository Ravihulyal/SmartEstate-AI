import type { Server } from "socket.io";
import prisma from "../config/prisma";
import {
  broadcastAuctionStatus,
  type AuctionStatusPayload
} from "./auction-socket.service";

const STATUS_SCAN_INTERVAL_MS = 5_000;

export function startAuctionStatusBroadcasts(io: Server): () => void {
  let stopped = false;
  let scanInProgress = false;

  const scan = async () => {
    if (stopped || scanInProgress) return;
    scanInProgress = true;

    try {
      const now = new Date();
      const auctions = await prisma.auction.findMany({
        where: {
          status: { in: ["UPCOMING", "ACTIVE"] },
          OR: [
            { status: "UPCOMING", startTime: { lte: now }, endTime: { gt: now } },
            { endTime: { lte: now } }
          ]
        },
        select: {
          id: true,
          status: true,
          startTime: true,
          endTime: true,
          currentBid: true
        }
      });

      for (const auction of auctions) {
        const status: AuctionStatusPayload["status"] = auction.endTime <= now
          ? "COMPLETED"
          : "ACTIVE";
        const result = await prisma.auction.updateMany({
          where: { id: auction.id, status: auction.status },
          data: { status }
        });

        if (result.count === 1) {
          broadcastAuctionStatus(io, {
            auctionId: auction.id,
            status,
            startTime: auction.startTime.toISOString(),
            endTime: auction.endTime.toISOString(),
            currentBid: auction.currentBid
          });
        }
      }
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
