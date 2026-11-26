import { Prisma } from "@prisma/client";
import { Response } from "express";
import { z } from "zod";
import prisma from "../config/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

const propertyIdSchema = z.string().cuid();

const favoritePropertySelect = {
  id: true,
  title: true,
  description: true,
  location: true,
  city: true,
  state: true,
  propertyType: true,
  listingType: true,
  totalSqft: true,
  bhk: true,
  bathrooms: true,
  price: true,
  rentPerMonth: true,
  predictedPriceLakhs: true,
  images: true,
  status: true,
  sellerId: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.PropertySelect;

function parsePropertyId(value: unknown): string | null {
  const parsed = propertyIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function getFavorites(req: AuthRequest, res: Response) {
  try {
    const favorites = await prisma.favorite.findMany({
      where: {
        userId: req.user!.id,
        property: { status: "APPROVED" }
      },
      select: {
        property: { select: favoritePropertySelect }
      },
      orderBy: { createdAt: "desc" }
    });

    const properties = favorites.map(({ property }) => property);
    return res.status(200).json({ count: properties.length, properties });
  } catch (error) {
    console.error("Get favorites error:", error);
    return res.status(500).json({ message: "Unable to fetch your favorites" });
  }
}

export async function addFavorite(req: AuthRequest, res: Response) {
  const propertyId = parsePropertyId(req.params.propertyId);
  if (!propertyId) {
    return res.status(400).json({ message: "Invalid property ID" });
  }

  try {
    const property = await prisma.property.findFirst({
      where: { id: propertyId, status: "APPROVED" },
      select: favoritePropertySelect
    });

    if (!property) {
      return res.status(404).json({ message: "Approved property not found" });
    }

    const favorite = await prisma.favorite.create({
      data: { userId: req.user!.id, propertyId },
      select: { property: { select: favoritePropertySelect } }
    });

    return res.status(201).json({
      message: "Property added to favorites",
      property: favorite.property
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ message: "Property is already in your favorites" });
    }

    console.error("Add favorite error:", error);
    return res.status(500).json({ message: "Unable to add property to favorites" });
  }
}

export async function removeFavorite(req: AuthRequest, res: Response) {
  const propertyId = parsePropertyId(req.params.propertyId);
  if (!propertyId) {
    return res.status(400).json({ message: "Invalid property ID" });
  }

  try {
    const result = await prisma.favorite.deleteMany({
      where: { userId: req.user!.id, propertyId }
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Favorite not found" });
    }

    return res.status(200).json({ message: "Property removed from favorites" });
  } catch (error) {
    console.error("Remove favorite error:", error);
    return res.status(500).json({ message: "Unable to remove property from favorites" });
  }
}
