
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: "BUYER" | "SELLER" | "ADMIN";
  };
}

type TokenVerification =
  | { user: NonNullable<AuthRequest["user"]> }
  | { error: "claims" | "token" };

function verifyToken(token: string): TokenVerification {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;

    if (
      typeof decoded.sub !== "string" ||
      !["BUYER", "SELLER", "ADMIN"].includes(decoded.role)
    ) {
      return { error: "claims" };
    }

    return {
      user: {
        id: decoded.sub,
        role: decoded.role as "BUYER" | "SELLER" | "ADMIN"
      }
    };
  } catch {
    return { error: "token" };
  }
}

export function getAuthenticatedUser(token: string): AuthRequest["user"] | null {
  const result = verifyToken(token);
  return "user" in result ? result.user : null;
}

function invalidTokenMessage(result: Exclude<TokenVerification, { user: unknown }>): string {
  return result.error === "claims" ? "Invalid authentication token" : "Invalid or expired token";
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

  const result = verifyToken(token);
  if ("error" in result) {
    return res.status(401).json({
      success: false,
      message: invalidTokenMessage(result)
    });
  }

  req.user = result.user;
  next();
}
