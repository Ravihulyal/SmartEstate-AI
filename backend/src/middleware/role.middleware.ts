
import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.middleware";

export function authorizeRoles(...allowedRoles: Array<"BUYER" | "SELLER" | "ADMIN">) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        message: "Authentication required"
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You are not authorized to perform this action"
      });
    }

    next();
  };
}
