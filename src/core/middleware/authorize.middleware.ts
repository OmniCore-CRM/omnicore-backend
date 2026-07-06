import type { NextFunction, Response } from "express";
import { UserRole } from "@prisma/client";
import { AppError } from "@/core/errors/app-error.js";
import type { AuthenticatedRequest } from "./auth.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import {
  Permissions,
  rolesWithPermission,
} from "@/core/permissions/permission-policy.js";

export const RBAC = {
  admin: rolesWithPermission(Permissions.manageSettings),
  adminAndLead: rolesWithPermission(Permissions.manageTeams),
  operational: rolesWithPermission(Permissions.operationalConversationActions),
  readOnly: rolesWithPermission(Permissions.viewAnalytics),
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
