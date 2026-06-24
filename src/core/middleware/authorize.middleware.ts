import type { NextFunction, Response } from "express";
import { AppError } from "@/core/errors/app-error.js";
import type { AuthenticatedRequest } from "./auth.middleware.js";
import type { UserRole } from "@prisma/client";
import { HTTP_STATUS } from "@/core/constants/http-status.js";

export const authorize =
  (...allowedRoles: UserRole[]) =>
    (
      req: AuthenticatedRequest,
      _res: Response,
      next: NextFunction
    ) => {
      if (!req.user) {
        throw new AppError("Unauthorized access", HTTP_STATUS.UNAUTHORIZED);
      }

      if (!allowedRoles.includes(req.user.role as UserRole)) {
        throw new AppError(
          "Forbidden: insufficient permissions",
          HTTP_STATUS.FORBIDDEN
        );
      }

      next();
    };
