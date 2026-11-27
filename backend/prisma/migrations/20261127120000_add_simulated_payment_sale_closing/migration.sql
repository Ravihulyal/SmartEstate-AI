CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED');

CREATE TYPE "SaleClosingStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

ALTER TYPE "AuctionAdminAction" ADD VALUE 'PAYMENT_CREATED';
ALTER TYPE "AuctionAdminAction" ADD VALUE 'PAYMENT_SUCCEEDED';
ALTER TYPE "AuctionAdminAction" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "AuctionAdminAction" ADD VALUE 'PAYMENT_EXPIRED';
ALTER TYPE "AuctionAdminAction" ADD VALUE 'SALE_CLOSING_CREATED';
ALTER TYPE "AuctionAdminAction" ADD VALUE 'SALE_CLOSING_COMPLETED';
ALTER TYPE "AuctionAdminAction" ADD VALUE 'SALE_CLOSING_CANCELLED';

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "winningBidId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "transactionReference" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'SIMULATED',
    "providerReference" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Payment_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "Payment_currency_inr_check" CHECK ("currency" = 'INR'),
    CONSTRAINT "Payment_transactionReference_nonempty_check" CHECK ("transactionReference" <> ''),
    CONSTRAINT "Payment_provider_nonempty_check" CHECK ("provider" <> ''),
    CONSTRAINT "Payment_simulated_only_check" CHECK ("isSimulated" IS TRUE AND "provider" = 'SIMULATED'),
    CONSTRAINT "Payment_paidAt_status_check" CHECK (
        ("status" = 'SUCCESS' AND "paidAt" IS NOT NULL)
        OR ("status" <> 'SUCCESS' AND "paidAt" IS NULL)
    ),
    CONSTRAINT "Payment_expiry_after_creation_check" CHECK (
        "expiresAt" IS NULL OR "expiresAt" > "createdAt"
    )
);

CREATE TABLE "SaleClosing" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "status" "SaleClosingStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SaleClosing_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SaleClosing_completion_timestamp_check" CHECK (
        ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "completedAt" >= "createdAt")
        OR ("status" <> 'COMPLETED' AND "completedAt" IS NULL)
    )
);

ALTER TABLE "AuctionAuditLog"
    ADD COLUMN "buyerId" TEXT,
    ADD COLUMN "paymentId" TEXT,
    ADD COLUMN "saleClosingId" TEXT;

CREATE UNIQUE INDEX "Payment_transactionReference_key"
    ON "Payment"("transactionReference");
CREATE UNIQUE INDEX "Payment_providerReference_key"
    ON "Payment"("providerReference");
CREATE INDEX "Payment_auctionId_status_idx"
    ON "Payment"("auctionId", "status");
CREATE INDEX "Payment_propertyId_status_idx"
    ON "Payment"("propertyId", "status");
CREATE INDEX "Payment_buyerId_status_idx"
    ON "Payment"("buyerId", "status");
CREATE INDEX "Payment_sellerId_status_idx"
    ON "Payment"("sellerId", "status");
CREATE INDEX "Payment_status_expiresAt_idx"
    ON "Payment"("status", "expiresAt");

CREATE UNIQUE INDEX "SaleClosing_auctionId_key"
    ON "SaleClosing"("auctionId");
CREATE UNIQUE INDEX "SaleClosing_paymentId_key"
    ON "SaleClosing"("paymentId");
CREATE INDEX "SaleClosing_propertyId_status_idx"
    ON "SaleClosing"("propertyId", "status");
CREATE INDEX "SaleClosing_buyerId_status_idx"
    ON "SaleClosing"("buyerId", "status");
CREATE INDEX "SaleClosing_sellerId_status_idx"
    ON "SaleClosing"("sellerId", "status");

CREATE INDEX "AuctionAuditLog_paymentId_idx"
    ON "AuctionAuditLog"("paymentId");
CREATE INDEX "AuctionAuditLog_saleClosingId_idx"
    ON "AuctionAuditLog"("saleClosingId");

ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_auctionId_fkey"
    FOREIGN KEY ("auctionId") REFERENCES "Auction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Payment_winningBidId_fkey"
    FOREIGN KEY ("winningBidId") REFERENCES "Bid"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Payment_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Payment_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Payment_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleClosing"
    ADD CONSTRAINT "SaleClosing_auctionId_fkey"
    FOREIGN KEY ("auctionId") REFERENCES "Auction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "SaleClosing_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "SaleClosing_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "SaleClosing_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "SaleClosing_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuctionAuditLog"
    ADD CONSTRAINT "AuctionAuditLog_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuctionAuditLog_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "AuctionAuditLog_saleClosingId_fkey"
    FOREIGN KEY ("saleClosingId") REFERENCES "SaleClosing"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_payment_context"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    auction_outcome "AuctionOutcomeStatus";
    auction_winning_bid_id TEXT;
    auction_property_id TEXT;
    bid_auction_id TEXT;
    bid_buyer_id TEXT;
    bid_amount DOUBLE PRECISION;
    bidder_role "UserRole";
    property_seller_id TEXT;
BEGIN
    SELECT "outcomeStatus", "winningBidId", "propertyId"
      INTO auction_outcome, auction_winning_bid_id, auction_property_id
      FROM "Auction"
     WHERE "id" = NEW."auctionId"
     FOR SHARE;

    IF NOT FOUND OR auction_outcome IS DISTINCT FROM 'ACCEPTED'::"AuctionOutcomeStatus" THEN
        RAISE EXCEPTION 'Payment requires an accepted auction outcome'
            USING ERRCODE = '23514';
    END IF;

    IF auction_winning_bid_id IS DISTINCT FROM NEW."winningBidId"
       OR auction_property_id IS DISTINCT FROM NEW."propertyId" THEN
        RAISE EXCEPTION 'Payment does not match the accepted auction winner and property'
            USING ERRCODE = '23514';
    END IF;

    SELECT b."auctionId", b."bidderId", b."amount", u."role"
      INTO bid_auction_id, bid_buyer_id, bid_amount, bidder_role
      FROM "Bid" b
      JOIN "User" u ON u."id" = b."bidderId"
     WHERE b."id" = NEW."winningBidId"
     FOR SHARE OF b, u;

    IF NOT FOUND
       OR bid_auction_id IS DISTINCT FROM NEW."auctionId"
       OR bid_buyer_id IS DISTINCT FROM NEW."buyerId"
       OR bidder_role IS DISTINCT FROM 'BUYER'::"UserRole"
       OR NEW."amount"::DOUBLE PRECISION IS DISTINCT FROM bid_amount THEN
        RAISE EXCEPTION 'Payment buyer or amount does not match the accepted winning bid'
            USING ERRCODE = '23514';
    END IF;

    SELECT "sellerId"
      INTO property_seller_id
      FROM "Property"
     WHERE "id" = NEW."propertyId"
     FOR SHARE;

    IF NOT FOUND OR property_seller_id IS DISTINCT FROM NEW."sellerId" THEN
        RAISE EXCEPTION 'Payment seller does not own the auction property'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "SaleClosing"
         WHERE "paymentId" = NEW."id"
    ) AND NEW."status" <> 'SUCCESS' THEN
        RAISE EXCEPTION 'A payment linked to a sale closing must remain successful'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "Payment_validate_context_insert"
    BEFORE INSERT
    ON "Payment"
    FOR EACH ROW
    EXECUTE FUNCTION "validate_payment_context"();

CREATE TRIGGER "Payment_validate_context_update"
    BEFORE UPDATE OF "auctionId", "winningBidId", "propertyId", "buyerId", "sellerId", "amount", "currency", "status"
    ON "Payment"
    FOR EACH ROW
    EXECUTE FUNCTION "validate_payment_context"();

CREATE FUNCTION "validate_sale_closing_context"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    payment_record "Payment"%ROWTYPE;
    auction_outcome "AuctionOutcomeStatus";
    auction_winning_bid_id TEXT;
    auction_property_id TEXT;
    property_seller_id TEXT;
BEGIN
    SELECT *
      INTO payment_record
      FROM "Payment"
     WHERE "id" = NEW."paymentId"
     FOR SHARE;

    IF NOT FOUND
       OR payment_record."status" <> 'SUCCESS'
       OR payment_record."auctionId" IS DISTINCT FROM NEW."auctionId"
       OR payment_record."propertyId" IS DISTINCT FROM NEW."propertyId"
       OR payment_record."buyerId" IS DISTINCT FROM NEW."buyerId"
       OR payment_record."sellerId" IS DISTINCT FROM NEW."sellerId" THEN
        RAISE EXCEPTION 'Sale closing must reference its matching successful payment'
            USING ERRCODE = '23514';
    END IF;

    SELECT "outcomeStatus", "winningBidId", "propertyId"
      INTO auction_outcome, auction_winning_bid_id, auction_property_id
      FROM "Auction"
     WHERE "id" = NEW."auctionId"
     FOR SHARE;

    IF NOT FOUND
       OR auction_outcome IS DISTINCT FROM 'ACCEPTED'::"AuctionOutcomeStatus"
       OR auction_winning_bid_id IS DISTINCT FROM payment_record."winningBidId"
       OR auction_property_id IS DISTINCT FROM NEW."propertyId" THEN
        RAISE EXCEPTION 'Sale closing does not match the accepted auction outcome'
            USING ERRCODE = '23514';
    END IF;

    SELECT "sellerId"
      INTO property_seller_id
      FROM "Property"
     WHERE "id" = NEW."propertyId"
     FOR SHARE;

    IF NOT FOUND OR property_seller_id IS DISTINCT FROM NEW."sellerId" THEN
        RAISE EXCEPTION 'Sale closing seller does not own the auction property'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "SaleClosing_validate_context_insert"
    BEFORE INSERT
    ON "SaleClosing"
    FOR EACH ROW
    EXECUTE FUNCTION "validate_sale_closing_context"();

CREATE TRIGGER "SaleClosing_validate_context_update"
    BEFORE UPDATE OF "auctionId", "propertyId", "paymentId", "buyerId", "sellerId", "status"
    ON "SaleClosing"
    FOR EACH ROW
    EXECUTE FUNCTION "validate_sale_closing_context"();
