
import { Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "../config/prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { predictPrice } from "../services/ml.service";

// PROPERTY VALIDATION SCHEMA

const propertyBaseSchema = z.object({
  title: z.string().trim().min(5).max(150),
  description: z.string().trim().min(10).max(5000),
  location: z.string().trim().min(2),
  city: z.string().trim().min(2),
  state: z.string().trim().min(2),

  propertyType: z.enum([
    "APARTMENT",
    "VILLA",
    "HOUSE",
    "PLOT",
    "COMMERCIAL"
  ]),

  listingType: z.enum(["SALE", "RENT"]),

  totalSqft: z.coerce.number().positive(),
  bhk: z.coerce.number().int().positive(),
  bathrooms: z.coerce.number().int().positive(),

  price: z.coerce.number().positive().optional(),
  rentPerMonth: z.coerce.number().positive().optional(),

  images: z.array(z.string().url()).optional().default([])
});

const propertySchema = propertyBaseSchema.superRefine((data, ctx) => {
  if (data.listingType === "SALE" && !data.price) {
    ctx.addIssue({
      code: "custom",
      path: ["price"],
      message: "Sale price is required"
    });
  }

  if (data.listingType === "RENT" && !data.rentPerMonth) {
    ctx.addIssue({
      code: "custom",
      path: ["rentPerMonth"],
      message: "Monthly rent is required"
    });
  }
});

const updatePropertySchema = propertyBaseSchema.partial();

// SELECTED PROPERTY FIELDS

const propertySelect = {
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


// CREATE PROPERTY WITH ML PRICE PREDICTION

export async function createProperty(
  req: AuthRequest,
  res: Response
) {
  try {
    const result = propertySchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid property details",
        errors: result.error.flatten()
      });
    }

    const data = result.data;

    let predictedPriceLakhs: number | null = null;

    // Predict property price for SALE listings
    if (data.listingType === "SALE") {
      try {
        const prediction = await predictPrice({
          location: data.location,
          total_sqft: data.totalSqft,
          bhk: data.bhk,
          bath: data.bathrooms
        });

        predictedPriceLakhs =
          prediction.predicted_price_lakhs;

        if (
          typeof predictedPriceLakhs !== "number" ||
          !Number.isFinite(predictedPriceLakhs) ||
          predictedPriceLakhs <= 0
        ) {
          throw new Error("Invalid price prediction received from ML service");
        }

      } catch (mlError) {
        console.error("Price prediction error:", mlError);

        return res.status(503).json({
          message: "Price prediction service is unavailable. Please try again later."
        });
      }
    }

    // Save property and ML prediction in Neon PostgreSQL
    const property = await prisma.property.create({
      data: {
        ...data,
        price: data.listingType === "SALE" ? data.price : null,
        rentPerMonth:
          data.listingType === "RENT" ? data.rentPerMonth : null,
        predictedPriceLakhs,
        sellerId: req.user!.id,
        status: "PENDING"
      },
      select: propertySelect
    });

    return res.status(201).json({
      message: "Property submitted for admin approval",
      property,
      predictedPriceLakhs,
      predictionLabel:
        data.listingType === "SALE"
          ? "Estimated sale price from the AI model (lakhs of INR); not a guaranteed market value"
          : null
    });

  } catch (error) {
    console.error("Create property error:", error);

    return res.status(500).json({
      message: "Unable to create property"
    });
  }
}


// GET ALL APPROVED PROPERTIES

export async function getProperties(
  req: AuthRequest,
  res: Response
) {
  try {
    const filters = z.object({
      city: z.string().optional(),
      listingType: z.enum(["SALE", "RENT"]).optional(),
      propertyType: z.enum([
        "APARTMENT",
        "VILLA",
        "HOUSE",
        "PLOT",
        "COMMERCIAL"
      ]).optional(),
      bhk: z.coerce.number().int().positive().optional()
    }).safeParse(req.query);

    if (!filters.success) {
      return res.status(400).json({
        message: "Invalid search filters"
      });
    }

    const { city, listingType, propertyType, bhk } = filters.data;

    const properties = await prisma.property.findMany({
      where: {
        status: "APPROVED",
        ...(city && {
          city: {
            contains: city,
            mode: "insensitive"
          }
        }),
        ...(listingType && { listingType }),
        ...(propertyType && { propertyType }),
        ...(bhk && { bhk })
      },
      select: {
        ...propertySelect,
        seller: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return res.status(200).json({
      count: properties.length,
      properties
    });

  } catch (error) {
    console.error("Get properties error:", error);

    return res.status(500).json({
      message: "Unable to fetch properties"
    });
  }
}


// GET SINGLE APPROVED PROPERTY

export async function getPropertyById(
  req: AuthRequest,
  res: Response
) {
  try {
    const propertyId = String(req.params.id);

    const property = await prisma.property.findFirst({
      where: {
        id: propertyId,
        status: "APPROVED"
      },
      select: {
        ...propertySelect,
        seller: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!property) {
      return res.status(404).json({
        message: "Property not found"
      });
    }

    return res.status(200).json({ property });

  } catch (error) {
    console.error("Get property error:", error);

    return res.status(500).json({
      message: "Unable to fetch property"
    });
  }
}


// GET SELLER'S OWN LISTINGS

export async function getMyProperties(
  req: AuthRequest,
  res: Response
) {
  try {
    const properties = await prisma.property.findMany({
      where: {
        sellerId: req.user!.id
      },
      select: propertySelect,
      orderBy: {
        createdAt: "desc"
      }
    });

    return res.status(200).json({
      count: properties.length,
      properties
    });

  } catch (error) {
    console.error("Get my properties error:", error);

    return res.status(500).json({
      message: "Unable to fetch your properties"
    });
  }
}


// UPDATE SELLER'S OWN PROPERTY

export async function updateProperty(
  req: AuthRequest,
  res: Response
) {
  try {
    const propertyId = String(req.params.id);

    const property = await prisma.property.findFirst({
      where: {
        id: propertyId,
        sellerId: req.user!.id
      }
    });

    if (!property) {
      return res.status(404).json({
        message: "Property not found"
      });
    }

    if (!["PENDING", "REJECTED"].includes(property.status)) {
      return res.status(400).json({
        message: "Only pending or rejected properties can be edited"
      });
    }

    const result = updatePropertySchema.safeParse(req.body);

    if (
      !result.success ||
      Object.keys(result.data || {}).length === 0
    ) {
      return res.status(400).json({
        message: "Provide valid property fields to update",
        errors: result.success ? undefined : result.error.flatten()
      });
    }

    const mergedData = {
      title: property.title,
      description: property.description,
      location: property.location,
      city: property.city,
      state: property.state,
      propertyType: property.propertyType,
      listingType: property.listingType,
      totalSqft: property.totalSqft,
      bhk: property.bhk,
      bathrooms: property.bathrooms,
      price: property.price ?? undefined,
      rentPerMonth: property.rentPerMonth ?? undefined,
      images: property.images,
      ...result.data
    };

    const validated = propertySchema.safeParse(mergedData);

    if (!validated.success) {
      return res.status(400).json({
        message: "Updated property details are incomplete or invalid",
        errors: validated.error.flatten()
      });
    }

    const data = validated.data;

    let predictedPriceLakhs: number | null = null;

    if (data.listingType === "SALE") {
      try {
        const prediction = await predictPrice({
          location: data.location,
          total_sqft: data.totalSqft,
          bhk: data.bhk,
          bath: data.bathrooms
        });

        predictedPriceLakhs = prediction.predicted_price_lakhs;

        if (
          typeof predictedPriceLakhs !== "number" ||
          !Number.isFinite(predictedPriceLakhs) ||
          predictedPriceLakhs <= 0
        ) {
          throw new Error("Invalid price prediction received from ML service");
        }
      } catch (mlError) {
        console.error("Price prediction error:", mlError);

        return res.status(503).json({
          message:
            "Price prediction service is unavailable or returned an invalid prediction. Please try again later."
        });
      }
    }

    const updatedProperty = await prisma.property.update({
      where: { id: property.id },
      data: {
        ...data,
        price: data.listingType === "SALE" ? data.price : null,
        rentPerMonth:
          data.listingType === "RENT" ? data.rentPerMonth : null,
        predictedPriceLakhs,
        status: "PENDING"
      },
      select: propertySelect
    });

    return res.status(200).json({
      message: "Property updated and resubmitted for approval",
      property: updatedProperty,
      predictedPriceLakhs,
      predictionLabel:
        data.listingType === "SALE"
          ? "Estimated sale price from the AI model (lakhs of INR); not a guaranteed market value"
          : null
    });

  } catch (error) {
    console.error("Update property error:", error);

    return res.status(500).json({
      message: "Unable to update property"
    });
  }
}


// ADMIN APPROVES OR REJECTS PROPERTY

export async function updatePropertyStatus(
  req: AuthRequest,
  res: Response
) {
  try {
    const propertyId = String(req.params.id);

    const bodySchema = z.object({
      status: z.enum(["APPROVED", "REJECTED"])
    });

    const result = bodySchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Status must be APPROVED or REJECTED"
      });
    }

    const existing = await prisma.property.findUnique({
      where: { id: propertyId }
    });

    if (!existing) {
      return res.status(404).json({
        message: "Property not found"
      });
    }

    const property = await prisma.property.update({
      where: { id: propertyId },
      data: {
        status: result.data.status
      },
      select: propertySelect
    });

    return res.status(200).json({
      message: `Property ${result.data.status.toLowerCase()} successfully`,
      property
    });

  } catch (error) {
    console.error("Update property status error:", error);

    return res.status(500).json({
      message: "Unable to update property status"
    });
  }
}


// GET ALL PENDING PROPERTIES (ADMIN)

export async function getPendingProperties(
  req: AuthRequest,
  res: Response
) {
  try {
    const properties = await prisma.property.findMany({
      where: {
        status: "PENDING"
      },
      select: {
        ...propertySelect,
        seller: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    return res.status(200).json({
      count: properties.length,
      properties
    });

  } catch (error) {
    console.error("Get pending properties error:", error);

    return res.status(500).json({
      message: "Unable to fetch pending properties"
    });
  }
}
