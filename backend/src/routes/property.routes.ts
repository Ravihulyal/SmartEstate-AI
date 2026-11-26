
import { Router } from "express";
import { rateLimit } from "express-rate-limit";

import {
  createProperty,
  getProperties,
  getPropertyById,
  getMyProperties,
  updateProperty,
  updatePropertyStatus,
  getPendingProperties
} from "../controllers/property.controller";

import { authenticateToken } from "../middleware/auth.middleware";
import { authorizeRoles } from "../middleware/role.middleware";
import { parsePropertyImageUpload } from "../middleware/property-image-upload.middleware";
import {
  deletePropertyImage,
  uploadPropertyImageFiles
} from "../controllers/property-image.controller";

const router = Router();

const propertyImageRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many image upload requests. Please try again later."
  }
});

// Seller-only Cloudinary image management
router.post(
  "/images",
  authenticateToken,
  authorizeRoles("SELLER"),
  propertyImageRateLimit,
  parsePropertyImageUpload,
  uploadPropertyImageFiles
);

router.delete(
  "/images",
  authenticateToken,
  authorizeRoles("SELLER"),
  propertyImageRateLimit,
  deletePropertyImage
);

// Public: view approved properties
router.get("/", getProperties);

// Seller: view own listings
router.get(
  "/my/listings",
  authenticateToken,
  authorizeRoles("SELLER"),
  getMyProperties
);

// Seller: add a property
router.post(
  "/",
  authenticateToken,
  authorizeRoles("SELLER"),
  createProperty
);

// Admin: view pending properties
router.get(
  "/admin/pending",
  authenticateToken,
  authorizeRoles("ADMIN"),
  getPendingProperties
);

// Admin: approve or reject a property
router.patch(
  "/:id/status",
  authenticateToken,
  authorizeRoles("ADMIN"),
  updatePropertyStatus
);

// Seller: update own property
router.patch(
  "/:id",
  authenticateToken,
  authorizeRoles("SELLER"),
  updateProperty
);

// Public: view an approved property
router.get("/:id", getPropertyById);

export default router;
