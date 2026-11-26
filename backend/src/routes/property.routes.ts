
import { Router } from "express";

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

const router = Router();

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
