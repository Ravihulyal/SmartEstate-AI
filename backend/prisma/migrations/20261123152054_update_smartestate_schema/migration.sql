/*
  Warnings:

  - You are about to drop the column `areaSqFt` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `bedrooms` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `ownerId` on the `Property` table. All the data in the column will be lost.
  - You are about to alter the column `price` on the `Property` table. The data in that column could be lost. The data in that column will be cast from `Decimal(12,2)` to `DoublePrecision`.
  - The `status` column on the `Property` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `password` on the `User` table. All the data in the column will be lost.
  - The `role` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `bhk` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Added the required column `listingType` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sellerId` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalSqft` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Made the column `description` on table `Property` required. This step will fail if there are existing NULL values in that column.
  - Changed the type of `propertyType` on the `Property` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `passwordHash` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('BUYER', 'SELLER', 'ADMIN');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'VILLA', 'HOUSE', 'PLOT', 'COMMERCIAL');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('SALE', 'RENT');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SOLD', 'RENTED');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "Property" DROP CONSTRAINT "Property_ownerId_fkey";

-- AlterTable
ALTER TABLE "Property" DROP COLUMN "areaSqFt",
DROP COLUMN "bedrooms",
DROP COLUMN "ownerId",
ADD COLUMN     "bhk" INTEGER NOT NULL,
ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "listingType" "ListingType" NOT NULL,
ADD COLUMN     "predictedPriceLakhs" DOUBLE PRECISION,
ADD COLUMN     "rentPerMonth" DOUBLE PRECISION,
ADD COLUMN     "sellerId" TEXT NOT NULL,
ADD COLUMN     "totalSqft" DOUBLE PRECISION NOT NULL,
ALTER COLUMN "description" SET NOT NULL,
ALTER COLUMN "price" DROP NOT NULL,
ALTER COLUMN "price" SET DATA TYPE DOUBLE PRECISION,
DROP COLUMN "propertyType",
ADD COLUMN     "propertyType" "PropertyType" NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "PropertyStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "password",
ADD COLUMN     "passwordHash" TEXT NOT NULL,
DROP COLUMN "role",
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'BUYER';

-- CreateTable
CREATE TABLE "Auction" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "startPrice" DOUBLE PRECISION NOT NULL,
    "currentBid" DOUBLE PRECISION,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "AuctionStatus" NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "auctionId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Auction_propertyId_key" ON "Auction"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_propertyId_key" ON "Favorite"("userId", "propertyId");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
