import type { Prisma } from "@prisma/client";

export async function completeAuction(
  transaction: Prisma.TransactionClient,
  auctionId: string,
  endTime?: Date
) {
  const winningBid = await transaction.bid.findFirst({
    where: { auctionId },
    orderBy: [{ amount: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, amount: true, bidderId: true }
  });

  const auction = await transaction.auction.update({
    where: { id: auctionId },
    data: {
      status: "COMPLETED",
      ...(endTime ? { endTime } : {}),
      outcomeStatus: winningBid ? "PENDING_SELLER_APPROVAL" : "NO_BIDS",
      winningBidId: winningBid?.id ?? null,
      sellerDecisionAt: null,
      sellerDecisionReason: null
    }
  });

  return { auction, winningBid };
}
