import type { NextFunction, Response } from "express";
import { UserRole } from "@prisma/client";
import { AppError } from "@/core/errors/app-error.js";
import type { AuthenticatedRequest } from "./auth.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";

export const RBAC = {
  admin: [UserRole.OWNER, UserRole.ADMIN],
  adminAndLead: [UserRole.OWNER, UserRole.ADMIN, UserRole.TEAM_LEAD],
  operational: [
    UserRole.OWNER,
    UserRole.ADMIN,
    UserRole.TEAM_LEAD,
    UserRole.AGENT,
  ],
  readOnly: [
    UserRole.OWNER,
    UserRole.ADMIN,
    UserRole.TEAM_LEAD,
    UserRole.AGENT,
    UserRole.VIEWER,
  ],
} as const satisfies Record<string, readonly UserRole[]>;

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
