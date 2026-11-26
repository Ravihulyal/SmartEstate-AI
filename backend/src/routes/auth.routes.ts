
import { Router } from "express";

import {
  register,
  login
} from "../controllers/auth.controller";

import prisma from "../config/prisma";

import {
  authenticateToken,
  AuthRequest
} from "../middleware/auth.middleware";

const router = Router();

// Register
router.post("/register", register);

// Login
router.post("/login", login);

// Get logged-in user
router.get(
  "/me",
  authenticateToken,
  async (req: AuthRequest, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: {
          id: req.user!.id
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true
        }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      return res.json({
        success: true,
        user
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message: "Unable to retrieve user"
      });
    }
  }
);

export default router;
