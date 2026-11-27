CREATE TYPE "AuctionOutcomeStatus" AS ENUM (
    'NO_BIDS',
    'PENDING_SELLER_APPROVAL',
    'ACCEPTED',
    'REJECTED'
);

ALTER TYPE "AuctionAdminAction" ADD VALUE IF NOT EXISTS 'WINNER_APPROVED';
ALTER TYPE "AuctionAdminAction" ADD VALUE IF NOT EXISTS 'WINNER_REJECTED';

ALTER TABLE "Auction"
    ADD COLUMN "outcomeStatus" "AuctionOutcomeStatus",
    ADD COLUMN "winningBidId" TEXT,
    ADD COLUMN "sellerDecisionAt" TIMESTAMP(3),
    ADD COLUMN "sellerDecisionReason" TEXT;

ALTER TABLE "AuctionAuditLog"
    ALTER COLUMN "adminId" DROP NOT NULL,
    ALTER COLUMN "reason" DROP NOT NULL,
    ADD COLUMN "sellerId" TEXT;

UPDATE "Auction" AS auction
SET
    "winningBidId" = (
        SELECT bid."id"
        FROM "Bid" AS bid
        WHERE bid."auctionId" = auction."id"
        ORDER BY bid."amount" DESC, bid."createdAt" ASC, bid."id" ASC
        LIMIT 1
    ),
    "outcomeStatus" = CASE
        WHEN EXISTS (
            SELECT 1
            FROM "Bid" AS bid
            WHERE bid."auctionId" = auction."id"
        ) THEN 'PENDING_SELLER_APPROVAL'::"AuctionOutcomeStatus"
        ELSE 'NO_BIDS'::"AuctionOutcomeStatus"
    END
WHERE auction."status" = 'COMPLETED';

CREATE UNIQUE INDEX "Auction_winningBidId_key" ON "Auction"("winningBidId");

ALTER TABLE "Auction"
    ADD CONSTRAINT "Auction_winningBidId_fkey"
    FOREIGN KEY ("winningBidId") REFERENCES "Bid"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuctionAuditLog"
    ADD CONSTRAINT "AuctionAuditLog_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
