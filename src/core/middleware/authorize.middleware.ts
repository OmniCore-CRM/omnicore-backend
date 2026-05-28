import type { NextFunction, Response } from "express";
import { AppError } from "@/core/errors/app-error.js";
import type { AuthenticatedRequest } from "./auth.middleware.js";
import { prisma } from "@/config/db.js";
import type { UserRole } from "@prisma/client";
import { HTTP_STATUS } from "@/core/constants/http-status.js";

// Restrict route access by user role
export const authorize =
  (...allowedRoles: UserRole[]) =>
    async (
      req: AuthenticatedRequest,
      _res: Response,
      next: NextFunction
    ) => {
      // Ensure authenticated user exists
      if (!req.user) {
        throw new AppError(
          "Unauthorized access",
          HTTP_STATUS.UNAUTHORIZED
        );
      }

      // Fetch latest user role from database
      const user = await prisma.user.findUnique({
        where: {
          id: req.user.userId,
        },

        select: {
          role: true,
        },
      });

      if (!user) {
        throw new AppError(
          "User not found",
          HTTP_STATUS.NOT_FOUND
        );
      }

      // Check if user role is allowed
      if (!allowedRoles.includes(user.role)) {
        throw new AppError(
          "Forbidden: insufficient permissions",
          HTTP_STATUS.FORBIDDEN
        );
      }

      next();
    };