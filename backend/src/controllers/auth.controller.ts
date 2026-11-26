
import { Request, Response } from "express";
import { z } from "zod";

import {
  registerUser,
  loginUser
} from "../services/auth.service";

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().transform(
    value => value.toLowerCase()
  ),
  password: z.string().min(8).max(72),
  role: z.enum(["BUYER", "SELLER"]).default("BUYER")
});

const loginSchema = z.object({
  email: z.string().trim().email().transform(
    value => value.toLowerCase()
  ),
  password: z.string().min(1).max(72)
});

// Register
export async function register(
  req: Request,
  res: Response
) {
  try {
    const validation = registerSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        errors: validation.error.flatten()
      });
    }

    const user = await registerUser(validation.data);

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      user
    });

  } catch (error: unknown) {
    if (error instanceof Error && error.message === "EMAIL_ALREADY_EXISTS") {
      return res.status(409).json({
        success: false,
        message: "Email is already registered"
      });
    }

    console.error("Registration error:", error);

    return res.status(500).json({
      success: false,
      message: "Registration failed"
    });
  }
}

// Login
export async function login(
  req: Request,
  res: Response
) {
  try {
    const validation = loginSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        errors: validation.error.flatten()
      });
    }

    const { email, password } = validation.data;

    const result = await loginUser(email, password);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      ...result
    });

  } catch (error: unknown) {
    if (error instanceof Error && error.message === "INVALID_CREDENTIALS") {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Login failed"
    });
  }
}
