
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: "BUYER" | "SELLER" | "ADMIN";
  };
}

export function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication token required"
    });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication token required"
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;

    if (
      typeof decoded.sub !== "string" ||
      !["BUYER", "SELLER", "ADMIN"].includes(decoded.role)
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token"
      });
    }

    req.user = {
      id: decoded.sub,
      role: decoded.role
    };

    next();

  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token"
    });
  }
}
