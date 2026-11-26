
import { Router } from "express";
import { rateLimit } from "express-rate-limit";

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

const registrationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many registration attempts. Please try again later." }
});

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again later." }
});

// Register
router.post("/register", registrationRateLimit, register);

// Login
router.post("/login", loginRateLimit, login);

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
