import { AuctionStatus, Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  broadcastAuctionBid,
  broadcastAuctionStatus
} from "../services/auction-socket.service";

const idSchema = z.string().cuid();
const moneySchema = z.number()
  .finite()
  .positive()
  .max(1_000_000_000_000)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7, {
    message: "Amount can have at most two decimal places"
  });

const createAuctionSchema = z.object({
  propertyId: idSchema,
  startPrice: moneySchema,
  startTime: z.string().datetime({ offset: true }),
  endTime: z.string().datetime({ offset: true })
}).strict();

const createBidSchema = z.object({
  amount: moneySchema
}).strict();

class AuctionRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function effectiveStatus(auction: {
  status: AuctionStatus;
  startTime: Date;
  endTime: Date;
}, now: Date): AuctionStatus {
  if (auction.status === "CANCELLED" || auction.status === "COMPLETED") {
    return auction.status;
  }
  if (now >= auction.endTime) return "COMPLETED";
  if (now >= auction.startTime) return "ACTIVE";
  return "UPCOMING";
}

function parseId(value: unknown): string | null {
  const result = idSchema.safeParse(value);
  return result.success ? result.data : null;
}

function publicAuctionSelect() {
  return {
    id: true,
    propertyId: true,
    startPrice: true,
    currentBid: true,
    startTime: true,
    endTime: true,
    status: true,
    createdAt: true,
    property: {
      select: {
        id: true,
        title: true,
        city: true,
        state: true,
        location: true,
        propertyType: true,
        listingType: true,
        price: true,
        rentPerMonth: true,
        images: true
      }
    }
  } satisfies Prisma.AuctionSelect;
}

export function createAuctionHandlers(io: Server) {
  return {
    async getAuctions(req: Request, res: Response) {
      const statusSchema = z.enum(["UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED"]).optional();
      const query = statusSchema.safeParse(req.query.status);
      if (!query.success) {
        return res.status(400).json({ message: "Invalid auction status filter" });
      }

      try {
        const auctions = await prisma.auction.findMany({
          where: {
            property: { status: "APPROVED" }
          },
          select: publicAuctionSelect(),
          orderBy: [{ startTime: "asc" }, { createdAt: "desc" }],
          take: 100
        });
        const now = new Date();
        const currentAuctions = auctions.map((auction) => ({
          ...auction,
          status: effectiveStatus(auction, now)
        }));
        const filteredAuctions = query.data
          ? currentAuctions.filter((auction) => auction.status === query.data)
          : currentAuctions;

        return res.status(200).json({
          count: filteredAuctions.length,
          auctions: filteredAuctions
        });
      } catch (error) {
        console.error("Get auctions error:", error);
        return res.status(500).json({ message: "Unable to fetch auctions" });
      }
    },

    async getAuction(req: Request, res: Response) {
      const auctionId = parseId(req.params.id);
      if (!auctionId) return res.status(400).json({ message: "Invalid auction ID" });

      try {
        const auction = await prisma.auction.findFirst({
          where: { id: auctionId, property: { status: "APPROVED" } },
          select: {
            ...publicAuctionSelect(),
            bids: {
              orderBy: { createdAt: "desc" },
              take: 20,
              select: { id: true, amount: true, createdAt: true }
            }
          }
        });
        if (!auction) return res.status(404).json({ message: "Auction not found" });

        return res.status(200).json({
          auction: {
            ...auction,
            status: effectiveStatus(auction, new Date())
          }
        });
      } catch (error) {
        console.error("Get auction error:", error);
        return res.status(500).json({ message: "Unable to fetch auction" });
      }
    },

    async createAuction(req: AuthRequest, res: Response) {
      const result = createAuctionSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid auction details",
          errors: result.error.flatten()
        });
      }

      const { propertyId, startPrice } = result.data;
      const startTime = new Date(result.data.startTime);
      const endTime = new Date(result.data.endTime);
      const now = new Date();
      if (startTime < now || endTime <= now || endTime <= startTime) {
        return res.status(400).json({
          message: "Auction must start now or later and end after its start time"
        });
      }

      try {
        const auction = await prisma.$transaction(async (transaction) => {
          const ownedProperty = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Property"
            WHERE "id" = ${propertyId} AND "sellerId" = ${req.user!.id}
            FOR UPDATE
          `;
          if (ownedProperty.length === 0) {
            throw new AuctionRequestError(404, "Your property was not found");
          }

          const property = await transaction.property.findUnique({
            where: { id: propertyId },
            select: { status: true }
          });
          if (!property || property.status !== "APPROVED") {
            throw new AuctionRequestError(409, "Only approved properties can be auctioned");
          }

          return transaction.auction.create({
            data: {
              propertyId,
              startPrice,
              startTime,
              endTime,
              status: startTime <= now ? "ACTIVE" : "UPCOMING"
            },
            select: publicAuctionSelect()
          });
        });
        const status = effectiveStatus(auction, new Date());
        broadcastAuctionStatus(io, {
          auctionId: auction.id,
          status,
          startTime: auction.startTime.toISOString(),
          endTime: auction.endTime.toISOString(),
          currentBid: auction.currentBid
        });
        return res.status(201).json({
          message: "Auction created",
          auction: { ...auction, status }
        });
      } catch (error) {
        if (error instanceof AuctionRequestError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return res.status(409).json({ message: "This property already has an auction" });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
          return res.status(404).json({ message: "Property not found" });
        }
        console.error("Create auction error:", error);
        return res.status(500).json({ message: "Unable to create auction" });
      }
    },

    async placeBid(req: AuthRequest, res: Response) {
      const auctionId = parseId(req.params.id);
      if (!auctionId) return res.status(400).json({ message: "Invalid auction ID" });

      const result = createBidSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid bid amount",
          errors: result.error.flatten()
        });
      }

      try {
        const outcome = await prisma.$transaction(async (transaction) => {
          const locked = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Auction" WHERE "id" = ${auctionId} FOR UPDATE
          `;
          if (locked.length === 0) {
            throw new AuctionRequestError(404, "Auction not found");
          }

          const auction = await transaction.auction.findUnique({
            where: { id: auctionId },
            include: { property: { select: { sellerId: true, status: true } } }
          });
          if (!auction || auction.property.status !== "APPROVED") {
            throw new AuctionRequestError(404, "Auction not found");
          }
          if (auction.property.sellerId === req.user!.id) {
            throw new AuctionRequestError(403, "You cannot bid on your own property");
          }

          const now = new Date();
          if (auction.status === "CANCELLED" || auction.status === "COMPLETED") {
            throw new AuctionRequestError(409, "This auction is closed");
          }
          if (now < auction.startTime) {
            throw new AuctionRequestError(409, "Bidding has not started");
          }
          if (now >= auction.endTime) {
            throw new AuctionRequestError(409, "This auction has ended");
          }

          const amount = result.data.amount;
          const highestBidCents = auction.currentBid === null
            ? toCents(auction.startPrice)
            : toCents(auction.currentBid);
          const amountCents = toCents(amount);
          if (auction.currentBid === null ? amountCents < highestBidCents : amountCents <= highestBidCents) {
            throw new AuctionRequestError(
              409,
              auction.currentBid === null
                ? "Bid must meet or exceed the starting price"
                : "Bid must exceed the current highest bid"
            );
          }

          const bid = await transaction.bid.create({
            data: {
              amount,
              auctionId,
              bidderId: req.user!.id
            },
            select: { id: true, amount: true, createdAt: true }
          });
          const updatedAuction = await transaction.auction.update({
            where: { id: auctionId },
            data: { currentBid: amount, status: "ACTIVE" },
            select: {
              id: true,
              currentBid: true,
              status: true,
              startTime: true,
              endTime: true
            }
          });

          return { bid, auction: updatedAuction, previousStatus: auction.status };
        });

        broadcastAuctionBid(io, {
          auctionId,
          amount: outcome.bid.amount,
          createdAt: outcome.bid.createdAt.toISOString(),
          currentBid: outcome.auction.currentBid!,
          status: "ACTIVE"
        });
        if (outcome.previousStatus !== "ACTIVE") {
          broadcastAuctionStatus(io, {
            auctionId,
            status: "ACTIVE",
            startTime: outcome.auction.startTime.toISOString(),
            endTime: outcome.auction.endTime.toISOString(),
            currentBid: outcome.auction.currentBid
          });
        }

        return res.status(201).json({
          message: "Bid placed",
          bid: outcome.bid,
          currentBid: outcome.auction.currentBid
        });
      } catch (error) {
        if (error instanceof AuctionRequestError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        console.error("Place bid error:", error);
        return res.status(500).json({ message: "Unable to place bid" });
      }
    },

    async getBids(req: Request, res: Response) {
      const auctionId = parseId(req.params.id);
      if (!auctionId) return res.status(400).json({ message: "Invalid auction ID" });

      try {
        const auction = await prisma.auction.findFirst({
          where: { id: auctionId, property: { status: "APPROVED" } },
          select: { id: true }
        });
        if (!auction) return res.status(404).json({ message: "Auction not found" });

        const bids = await prisma.bid.findMany({
          where: { auctionId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 100,
          select: { id: true, amount: true, createdAt: true }
        });
        return res.status(200).json({ count: bids.length, bids });
      } catch (error) {
        console.error("Get auction bids error:", error);
        return res.status(500).json({ message: "Unable to fetch bid history" });
      }
    }
  };
}
