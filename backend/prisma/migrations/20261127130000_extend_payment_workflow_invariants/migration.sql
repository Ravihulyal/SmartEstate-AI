ALTER TYPE "AuctionAdminAction" ADD VALUE 'PAYMENT_INITIATED';
ALTER TYPE "AuctionAdminAction" ADD VALUE 'PAYMENT_RETRY_INITIATED';

CREATE UNIQUE INDEX "Payment_auctionId_key"
    ON "Payment"("auctionId");
