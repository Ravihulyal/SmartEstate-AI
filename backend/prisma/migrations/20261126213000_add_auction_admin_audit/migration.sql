CREATE TYPE "AuctionAdminAction" AS ENUM ('CANCELLED', 'ENDED_EARLY');

CREATE TABLE "AuctionAuditLog" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" "AuctionAdminAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuctionAuditLog_auctionId_createdAt_idx"
    ON "AuctionAuditLog"("auctionId", "createdAt");

ALTER TABLE "AuctionAuditLog"
    ADD CONSTRAINT "AuctionAuditLog_auctionId_fkey"
    FOREIGN KEY ("auctionId") REFERENCES "Auction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuctionAuditLog"
    ADD CONSTRAINT "AuctionAuditLog_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
