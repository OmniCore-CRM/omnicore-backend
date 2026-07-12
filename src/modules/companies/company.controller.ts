import type { Response } from "express";
import { UserRole } from "@prisma/client";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { CompanyService } from "./company.service.js";

export class CompanyController {
  static updateProfile = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      if (req.user!.role !== UserRole.OWNER && req.user!.role !== UserRole.ADMIN) {
        throw new AppError(
          "Forbidden: insufficient permissions",
          HTTP_STATUS.FORBIDDEN,
        );
      }

      const payload = await CompanyService.updateCompanyProfile(
        req.user!.companyId,
        req.body,
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Company profile updated successfully",
        data: payload,
      });
    },
  );

  static getPortalSettings = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const payload = await CompanyService.getPortalSettings(req.user!.companyId);

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Company portal settings retrieved successfully",
        data: payload,
      });
    }
  );

  static updatePortalSettings = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const payload = await CompanyService.updatePortalSettings(
        req.user!.companyId,
        req.body
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Company portal settings updated successfully",
        data: payload,
      });
    }
  );
}
