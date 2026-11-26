import { Router } from "express";
import {
  addFavorite,
  getFavorites,
  removeFavorite
} from "../controllers/favorites.controller";
import { authenticateToken } from "../middleware/auth.middleware";
import { authorizeRoles } from "../middleware/role.middleware";

const router = Router();

router.use(authenticateToken, authorizeRoles("BUYER"));
router.get("/", getFavorites);
router.post("/:propertyId", addFavorite);
router.delete("/:propertyId", removeFavorite);

export default router;
