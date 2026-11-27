import { AuctionStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import prisma from "../config/prisma";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  broadcastAuctionAwaitingSellerApproval,
  broadcastAuctionCancelled,
  broadcastAuctionEndedEarly,
  broadcastAuctionBid,
  broadcastAuctionNoBids,
  broadcastAuctionScheduleUpdated,
  broadcastAuctionStatus,
  broadcastAuctionWinnerApproved,
  broadcastAuctionWinnerRejected
} from "../services/auction-socket.service";
import { completeAuction } from "../services/auction-outcome.service";
import {
  PaymentWorkflowError,
  createPaymentRequestForAcceptedAuction
} from "../services/simulated-payment.service";
import { broadcastPaymentEvent } from "../services/payment-socket.service";

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

const scheduleSchema = z.object({
  startTime: z.string().datetime({ offset: true }),
  endTime: z.string().datetime({ offset: true })
}).strict();

const adminReasonSchema = z.object({
  reason: z.string().trim().min(5).max(500)
}).strict();

const approveWinnerSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional()
}).strict();

const rejectWinnerSchema = z.object({
  reason: z.string().trim().min(5).max(500)
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
    outcomeStatus: true,
    winningBid: { select: { amount: true } },
    sellerDecisionAt: true,
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

function sellerAuctionSelect() {
  return {
    ...publicAuctionSelect(),
    sellerDecisionReason: true,
    winningBid: {
      select: {
        amount: true,
        bidder: { select: { name: true } }
      }
    }
  } satisfies Prisma.AuctionSelect;
}

function adminAuctionSelect() {
  return {
    id: true,
    propertyId: true,
    startPrice: true,
    currentBid: true,
    startTime: true,
    endTime: true,
    status: true,
    outcomeStatus: true,
    sellerDecisionAt: true,
    sellerDecisionReason: true,
    winningBid: {
      select: {
        amount: true,
        bidder: { select: { name: true } }
      }
    },
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
        images: true,
        seller: { select: { id: true, name: true } }
      }
    }
  } satisfies Prisma.AuctionSelect;
}

function publicAuctionVisibilityFilter(): Prisma.AuctionWhereInput {
  return {
    OR: [
      { property: { status: "APPROVED" } },
      { status: "COMPLETED", property: { status: "SOLD" } }
    ]
  };
}

async function lockAuction(
  transaction: Prisma.TransactionClient,
  auctionId: string
) {
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
  if (!auction) {
    throw new AuctionRequestError(404, "Auction not found");
  }
  return auction;
}

function assertSellerOwnsApprovedProperty(
  auction: Awaited<ReturnType<typeof lockAuction>>,
  sellerId: string
): void {
  if (auction.property.sellerId !== sellerId) {
    throw new AuctionRequestError(403, "You cannot manage another seller's auction");
  }
  if (auction.property.status !== "APPROVED") {
    throw new AuctionRequestError(409, "Only auctions for approved properties can be managed");
  }
}

async function decideSellerWinner(
  database: typeof prisma,
  auctionId: string,
  sellerId: string,
  outcomeStatus: "ACCEPTED" | "REJECTED",
  reason: string | null
) {
  return database.$transaction(async (transaction) => {
    const current = await lockAuction(transaction, auctionId);
    assertSellerOwnsApprovedProperty(current, sellerId);
    if (
      current.status !== "COMPLETED" ||
      current.outcomeStatus !== "PENDING_SELLER_APPROVAL"
    ) {
      throw new AuctionRequestError(409, "This auction is not awaiting seller approval");
    }

    const winningBid = await transaction.bid.findFirst({
      where: { auctionId },
      orderBy: [{ amount: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, amount: true, bidderId: true }
    });
    if (!winningBid) {
      throw new AuctionRequestError(409, "This auction has no valid bids to decide");
    }

    const decisionAt = new Date();
    const auction = await transaction.auction.update({
      where: { id: auctionId },
      data: {
        outcomeStatus,
        winningBidId: winningBid.id,
        sellerDecisionAt: decisionAt,
        sellerDecisionReason: reason
      },
      select: publicAuctionSelect()
    });
    await transaction.auctionAuditLog.create({
      data: {
        auctionId,
        sellerId,
        action: outcomeStatus === "ACCEPTED" ? "WINNER_APPROVED" : "WINNER_REJECTED",
        reason
      }
    });

    const payment = outcomeStatus === "ACCEPTED"
      ? await createPaymentRequestForAcceptedAuction(transaction, {
          auctionId,
          propertyId: current.propertyId,
          winningBidId: winningBid.id,
          buyerId: winningBid.bidderId,
          sellerId: current.property.sellerId,
          amount: winningBid.amount,
          now: decisionAt
        })
      : null;

    return { auction, winningBid, payment };
  });
}

export function createAuctionHandlers(io: Server, database: typeof prisma = prisma) {
  return {
    async getAuctions(req: Request, res: Response) {
      const statusSchema = z.enum(["UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED"]).optional();
      const query = statusSchema.safeParse(req.query.status);
      if (!query.success) {
        return res.status(400).json({ message: "Invalid auction status filter" });
      }

      try {
        const auctions = await database.auction.findMany({
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

    async getMyAuctions(req: AuthRequest, res: Response) {
      try {
        const auctions = await database.auction.findMany({
          where: {
            property: {
              sellerId: req.user!.id,
              status: "APPROVED"
            }
          },
          select: sellerAuctionSelect(),
          orderBy: [{ startTime: "asc" }, { createdAt: "desc" }]
        });
        const now = new Date();
        return res.status(200).json({
          count: auctions.length,
          auctions: auctions.map((auction) => ({
            ...auction,
            status: effectiveStatus(auction, now)
          }))
        });
      } catch (error) {
        console.error("Get seller auctions error:", error);
        return res.status(500).json({ message: "Unable to fetch your auctions" });
      }
    },

    async getPendingSellerApprovals(req: AuthRequest, res: Response) {
      try {
        const auctions = await database.auction.findMany({
          where: {
            status: "COMPLETED",
            outcomeStatus: "PENDING_SELLER_APPROVAL",
            property: {
              sellerId: req.user!.id,
              status: "APPROVED"
            }
          },
          select: {
            id: true,
            startTime: true,
            endTime: true,
            outcomeStatus: true,
            winningBid: {
              select: {
                amount: true,
                bidder: { select: { name: true } }
              }
            },
            bids: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 100,
              select: { id: true, amount: true, createdAt: true }
            },
            property: {
              select: { id: true, title: true, images: true }
            }
          },
          orderBy: [{ endTime: "desc" }, { id: "desc" }]
        });

        return res.status(200).json({
          count: auctions.length,
          auctions: auctions.map((auction) => ({
            ...auction,
            winningBid: auction.winningBid
              ? {
                  amount: auction.winningBid.amount,
                  bidderName: auction.winningBid.bidder.name
                }
              : null
          }))
        });
      } catch (error) {
        console.error("Get pending seller approvals error:", error);
        return res.status(500).json({ message: "Unable to fetch pending winner approvals" });
      }
    },

    async getAllAuctions(_req: Request, res: Response) {
      try {
        const auctions = await database.auction.findMany({
          select: adminAuctionSelect(),
          orderBy: [{ startTime: "asc" }, { createdAt: "desc" }]
        });
        const now = new Date();
        return res.status(200).json({
          count: auctions.length,
          auctions: auctions.map((auction) => ({
            ...auction,
            status: effectiveStatus(auction, now)
          }))
        });
      } catch (error) {
        console.error("Get admin auctions error:", error);
        return res.status(500).json({ message: "Unable to fetch auctions" });
      }
    },

    async getAuctionAudit(req: Request, res: Response) {
      const auctionId = parseId(req.params.id);
      if (!auctionId) return res.status(400).json({ message: "Invalid auction ID" });

      try {
        const auction = await database.auction.findUnique({
          where: { id: auctionId },
          select: { id: true }
        });
        if (!auction) return res.status(404).json({ message: "Auction not found" });

        const rows = await database.$queryRaw<Array<{
          id: string;
          auctionId: string;
          adminId: string | null;
          sellerId: string | null;
          action: "CANCELLED" | "ENDED_EARLY" | "WINNER_APPROVED" | "WINNER_REJECTED";
          reason: string | null;
          createdAt: Date;
          adminName: string | null;
          sellerName: string | null;
        }>>`
          SELECT log."id", log."auctionId", log."adminId", log."sellerId",
                 log."action", log."reason", log."createdAt",
                 admin."name" AS "adminName", seller."name" AS "sellerName"
          FROM "AuctionAuditLog" AS log
          LEFT JOIN "User" AS admin ON admin."id" = log."adminId"
          LEFT JOIN "User" AS seller ON seller."id" = log."sellerId"
          WHERE log."auctionId" = ${auctionId}
          ORDER BY log."createdAt" DESC, log."id" DESC
        `;
        const audit = rows.map(({ adminName, sellerName, ...entry }) => ({
          ...entry,
          admin: adminName ? { name: adminName } : null,
          seller: sellerName ? { name: sellerName } : null
        }));
        return res.status(200).json({ count: audit.length, audit });
      } catch (error) {
        console.error("Get auction audit error:", error);
        return res.status(500).json({ message: "Unable to fetch auction audit history" });
      }
    },

    async getAuction(req: AuthRequest, res: Response) {
      const auctionId = parseId(req.params.id);
      if (!auctionId) return res.status(400).json({ message: "Invalid auction ID" });

      try {
        const auction = await database.auction.findFirst({
          where: { id: auctionId, ...publicAuctionVisibilityFilter() },
          select: {
            ...publicAuctionSelect(),
            winningBid: {
              select: { amount: true, bidderId: true }
            },
            bids: {
              orderBy: { createdAt: "desc" },
              take: 20,
              select: { id: true, amount: true, createdAt: true }
            }
          }
        });
        if (!auction) return res.status(404).json({ message: "Auction not found" });

        const { winningBid, ...auctionDetails } = auction;
        return res.status(200).json({
          auction: {
            ...auctionDetails,
            winningBid: winningBid ? { amount: winningBid.amount } : null,
            isWinningBidder: Boolean(
              winningBid && req.user?.id === winningBid.bidderId
            ),
            status: effectiveStatus(auction, new Date())
          }
        });
      } catch (error) {
        console.error("Get auction error:", error);
        return res.status(500).json({ message: "Unable to fetch auction" });
      }
    },

    async updateSchedule(req: AuthRequest, res: Response) {
      const auctionId = parseId(req.params.id);
      if (!auctionId) return res.status(400).json({ message: "Invalid auction ID" });

      const result = scheduleSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid auction schedule",
          errors: result.error.flatten()
        });
      }

      const startTime = new Date(result.data.startTime);
      const endTime = new Date(result.data.endTime);
      if (endTime <= startTime) {
        return res.status(400).json({ message: "Auction end time must be later than its start time" });
      }

      try {
        const auction = await database.$transaction(async (transaction) => {
          const current = await lockAuction(transaction, auctionId);
          if (req.user!.role === "SELLER") {
            assertSellerOwnsApprovedProperty(current, req.user!.id);
          }

          const now = new Date();
          if (
            current.status !== "UPCOMING" ||
            effectiveStatus(current, now) !== "UPCOMING"
          ) {
            throw new AuctionRequestError(409, "Only upcoming auctions can be rescheduled");
          }
          if (startTime <= now) {
            throw new AuctionRequestError(400, "Auction start time must be in the future");
          }

          return transaction.auction.update({
            where: { id: auctionId },
            data: { startTime, endTime, status: "UPCOMING" },
            select: publicAuctionSelect()
          });
        });

        const status = effectiveStatus(auction, new Date());
        const payload = {
          auctionId,
          status,
          startTime: auction.startTime.toISOString(),
          endTime: auction.endTime.toISOString(),
          currentBid: auction.currentBid
        } as const;
        broadcastAuctionScheduleUpdated(io, payload);
        return res.status(200).json({
          message: "Auction schedule updated",
          auction: { ...auction, status }
        });
      } catch (error) {
        if (error instanceof AuctionRequestError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        console.error("Update auction schedule error:", error);
        return res.status(500).json({ message: "Unable to update auction schedule" });
      }
    },

    async cancelAuction(req: AuthRequest, res: Response) {
      const auctionId = parseId(req.params.id);
      if (!auctionId) return res.status(400).json({ message: "Invalid auction ID" });

      let reason: string | undefined;
      if (req.user!.role === "ADMIN") {
        const result = adminReasonSchema.safeParse(req.body);
        if (!result.success) {
          return res.status(400).json({
            message: "A cancellation reason of 5 to 500 characters is required",
            errors: result.error.flatten()
          });
        }
        reason = result.data.reason;
      } else {
        const result = z.object({}).strict().safeParse(req.body ?? {});
        if (!result.success) {
          return res.status(400).json({ message: "Invalid cancellation details" });
        }
      }

      try {
        const auction = await database.$transaction(async (transaction) => {
          const current = await lockAuction(transaction, auctionId);
          const isAdmin = req.user!.role === "ADMIN";
          if (!isAdmin) {
            assertSellerOwnsApprovedProperty(current, req.user!.id);
          }

          const now = new Date();
          const status = effectiveStatus(current, now);
          if (isAdmin) {
            if (status !== "UPCOMING" && status !== "ACTIVE") {
              throw new AuctionRequestError(409, "Only upcoming or live auctions can be cancelled");
            }
          } else {
            if (
              current.status !== "UPCOMING" ||
              status !== "UPCOMING" ||
              now >= current.startTime
            ) {
              throw new AuctionRequestError(409, "You can only cancel an upcoming auction before it starts");
            }
            const bidCount = await transaction.bid.count({ where: { auctionId } });
            if (bidCount > 0) {
              throw new AuctionRequestError(409, "An auction with bids cannot be cancelled by its seller");
            }
          }

          const updated = await transaction.auction.update({
            where: { id: auctionId },
            data: { status: "CANCELLED" },
            select: publicAuctionSelect()
          });
          if (isAdmin) {
            if (reason === undefined) {
              throw new AuctionRequestError(400, "A cancellation reason is required");
            }
            await transaction.$executeRaw`
              INSERT INTO "AuctionAuditLog"
                ("id", "auctionId", "adminId", "action", "reason", "createdAt")
              VALUES
                (${randomUUID()}, ${auctionId}, ${req.user!.id},
                 ${"CANCELLED"}::"AuctionAdminAction", ${reason}, CURRENT_TIMESTAMP)
            `;
          }
          return updated;
        });

        const payload = {
          auctionId,
          status: "CANCELLED",
          startTime: auction.startTime.toISOString(),
          endTime: auction.endTime.toISOString(),
          currentBid: auction.currentBid
        } as const;
        broadcastAuctionCancelled(io, payload);
        return res.status(200).json({ message: "Auction cancelled", auction });
      } catch (error) {
        if (error instanceof AuctionRequestError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        console.error("Cancel auction error:", error);
        return res.status(500).json({ message: "Unable to cancel auction" });
      }
    },

    async endAuctionEarly(req: AuthRequest, res: Response) {
      const auctionId = parseId(req.params.id);
      if (!auctionId) return res.status(400).json({ message: "Invalid auction ID" });

      const result = adminReasonSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "An early-ending reason of 5 to 500 characters is required",
          errors: result.error.flatten()
        });
      }

      try {
        const outcome = await database.$transaction(async (transaction) => {
          const current = await lockAuction(transaction, auctionId);
          const endedAt = new Date();
          if (effectiveStatus(current, endedAt) !== "ACTIVE") {
            throw new AuctionRequestError(409, "Only live auctions can be ended early");
          }

          const completed = await completeAuction(transaction, auctionId, endedAt);
          await transaction.$executeRaw`
            INSERT INTO "AuctionAuditLog"
              ("id", "auctionId", "adminId", "action", "reason", "createdAt")
            VALUES
              (${randomUUID()}, ${auctionId}, ${req.user!.id},
               ${"ENDED_EARLY"}::"AuctionAdminAction", ${result.data.reason}, CURRENT_TIMESTAMP)
          `;
          const auction = await transaction.auction.findUnique({
            where: { id: auctionId },
            select: publicAuctionSelect()
          });
          if (!auction) throw new AuctionRequestError(404, "Auction not found");
          return { auction, winningBid: completed.winningBid };
        });

        const payload = {
          auctionId,
          status: "COMPLETED",
          startTime: outcome.auction.startTime.toISOString(),
          endTime: outcome.auction.endTime.toISOString(),
          currentBid: outcome.auction.currentBid
        } as const;
        broadcastAuctionEndedEarly(io, payload);
        const outcomePayload = {
          auctionId,
          status: "COMPLETED" as const,
          outcomeStatus: outcome.winningBid ? "PENDING_SELLER_APPROVAL" as const : "NO_BIDS" as const,
          winningBidAmount: outcome.winningBid?.amount ?? null,
          endTime: outcome.auction.endTime.toISOString()
        };
        if (outcome.winningBid) {
          broadcastAuctionAwaitingSellerApproval(io, outcomePayload);
        } else {
          broadcastAuctionNoBids(io, outcomePayload);
        }
        return res.status(200).json({ message: "Auction ended early", auction: outcome.auction });
      } catch (error) {
        if (error instanceof AuctionRequestError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        console.error("End auction early error:", error);
        return res.status(500).json({ message: "Unable to end auction early" });
      }
    },

    async approveWinner(req: AuthRequest, res: Response) {
      const auctionId = parseId(req.params.id);
      if (!auctionId) return res.status(400).json({ message: "Invalid auction ID" });

      const result = approveWinnerSchema.safeParse(req.body ?? {});
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid approval details",
          errors: result.error.flatten()
        });
      }

      try {
        const outcome = await decideSellerWinner(
          database,
          auctionId,
          req.user!.id,
          "ACCEPTED",
          result.data.reason ?? null
        );
        broadcastAuctionWinnerApproved(io, {
          auctionId,
          status: "COMPLETED",
          outcomeStatus: "ACCEPTED",
          winningBidAmount: outcome.winningBid.amount,
          endTime: outcome.auction.endTime.toISOString()
        }, outcome.winningBid.bidderId);
        if (outcome.payment) {
          const paymentPayload = {
            paymentId: outcome.payment.id,
            auctionId: outcome.payment.auctionId,
            status: outcome.payment.status,
            amount: outcome.payment.amount.toFixed(2),
            currency: outcome.payment.currency,
            transactionReference: outcome.payment.transactionReference,
            expiresAt: outcome.payment.expiresAt?.toISOString() ?? null,
            paymentMode: "SIMULATED",
            isRealPayment: false
          };
          broadcastPaymentEvent(
            io,
            "payment:request-created",
            {
              buyerId: outcome.payment.buyerId,
              sellerId: outcome.payment.sellerId
            },
            paymentPayload,
            {
              paymentId: outcome.payment.id,
              auctionId: outcome.payment.auctionId,
              propertyId: outcome.payment.propertyId,
              status: outcome.payment.status,
              amount: outcome.payment.amount.toFixed(2),
              currency: outcome.payment.currency,
              transactionReference: outcome.payment.transactionReference,
              paymentMode: "SIMULATED",
              isRealPayment: false
            }
          );
        }
        return res.status(200).json({
          message: "Highest bid accepted",
          auction: outcome.auction,
          paymentRequest: outcome.payment ? {
            id: outcome.payment.id,
            transactionReference: outcome.payment.transactionReference,
            amount: outcome.payment.amount.toFixed(2),
            currency: outcome.payment.currency,
            status: outcome.payment.status,
            expiresAt: outcome.payment.expiresAt,
            paymentMode: "SIMULATED",
            isRealPayment: false
          } : null
        });
      } catch (error) {
        if (error instanceof PaymentWorkflowError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        if (error instanceof AuctionRequestError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        console.error("Approve auction winner error:", error);
        return res.status(500).json({ message: "Unable to approve the highest bid" });
      }
    },

    async rejectWinner(req: AuthRequest, res: Response) {
      const auctionId = parseId(req.params.id);
      if (!auctionId) return res.status(400).json({ message: "Invalid auction ID" });

      const result = rejectWinnerSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "A rejection reason of 5 to 500 characters is required",
          errors: result.error.flatten()
        });
      }

      try {
        const outcome = await decideSellerWinner(
          database,
          auctionId,
          req.user!.id,
          "REJECTED",
          result.data.reason
        );
        broadcastAuctionWinnerRejected(io, {
          auctionId,
          status: "COMPLETED",
          outcomeStatus: "REJECTED",
          winningBidAmount: outcome.winningBid.amount,
          endTime: outcome.auction.endTime.toISOString()
        });
        return res.status(200).json({
          message: "Highest bid rejected; the property was not sold through this auction",
          auction: outcome.auction
        });
      } catch (error) {
        if (error instanceof AuctionRequestError) {
          return res.status(error.statusCode).json({ message: error.message });
        }
        console.error("Reject auction winner error:", error);
        return res.status(500).json({ message: "Unable to reject the highest bid" });
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
        const auction = await database.$transaction(async (transaction) => {
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
        const outcome = await database.$transaction(async (transaction) => {
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
        const auction = await database.auction.findFirst({
          where: { id: auctionId, ...publicAuctionVisibilityFilter() },
          select: { id: true }
        });
        if (!auction) return res.status(404).json({ message: "Auction not found" });

        const bids = await database.bid.findMany({
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
