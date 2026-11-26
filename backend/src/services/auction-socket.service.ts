import type { Server, Socket } from "socket.io";
import { z } from "zod";
import prisma from "../config/prisma";
import { getAuthenticatedUser } from "../middleware/auth.middleware";

export interface AuctionStatusPayload {
  auctionId: string;
  status: "UPCOMING" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  startTime: string;
  endTime: string;
  currentBid: number | null;
}

export interface AuctionBidPayload {
  auctionId: string;
  amount: number;
  createdAt: string;
  currentBid: number;
  status: "ACTIVE";
}

export function auctionRoom(auctionId: string): string {
  return `auction:${auctionId}`;
}

export function broadcastAuctionStatus(
  io: Server,
  payload: AuctionStatusPayload
): void {
  io.to(auctionRoom(payload.auctionId)).emit("auction:status", payload);
}

export function broadcastAuctionBid(
  io: Server,
  payload: AuctionBidPayload
): void {
  io.to(auctionRoom(payload.auctionId)).emit("auction:bid-updated", payload);
}

function currentStatus(auction: {
  status: AuctionStatusPayload["status"];
  startTime: Date;
  endTime: Date;
}, now: Date): AuctionStatusPayload["status"] {
  if (auction.status === "CANCELLED" || auction.status === "COMPLETED") {
    return auction.status;
  }
  if (now >= auction.endTime) return "COMPLETED";
  if (now >= auction.startTime) return "ACTIVE";
  return "UPCOMING";
}

function sendSocketError(socket: Socket, message: string): void {
  socket.emit("auction:error", { message });
}

export function initializeAuctionSockets(io: Server): void {
  io.use((socket, next) => {
    const authToken = socket.handshake.auth?.token;
    const authorization = socket.handshake.headers.authorization;
    const token = typeof authToken === "string"
      ? authToken
      : authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";
    const user = getAuthenticatedUser(token);

    if (!user) {
      next(new Error("Authentication required"));
      return;
    }

    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    const joinSchema = z.object({ auctionId: z.string().cuid() }).strict();

    socket.on("auction:join", async (payload: unknown) => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) {
        sendSocketError(socket, "Invalid auction room request");
        return;
      }

      try {
        const auction = await prisma.auction.findFirst({
          where: {
            id: parsed.data.auctionId,
            property: { status: "APPROVED" }
          },
          select: {
            id: true,
            status: true,
            startTime: true,
            endTime: true,
            currentBid: true
          }
        });

        if (!auction) {
          sendSocketError(socket, "Auction not found");
          return;
        }

        await socket.join(auctionRoom(auction.id));
        socket.emit("auction:status", {
          auctionId: auction.id,
          status: currentStatus(auction, new Date()),
          startTime: auction.startTime.toISOString(),
          endTime: auction.endTime.toISOString(),
          currentBid: auction.currentBid
        } satisfies AuctionStatusPayload);
      } catch (error) {
        console.error("Auction socket join error:", error);
        sendSocketError(socket, "Unable to join this auction");
      }
    });

    socket.on("auction:leave", (payload: unknown) => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) {
        sendSocketError(socket, "Invalid auction room request");
        return;
      }
      void socket.leave(auctionRoom(parsed.data.auctionId));
    });

    socket.on("auction:bid-updated", () => {
      sendSocketError(socket, "Bids must be placed through the authenticated API");
    });
    socket.on("auction:bid", () => {
      sendSocketError(socket, "Bids must be placed through the authenticated API");
    });
    socket.on("auction:status", () => {
      sendSocketError(socket, "Auction status is controlled by the server");
    });
  });
}
