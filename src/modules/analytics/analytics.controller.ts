import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { AnalyticsService } from "./analytics.service.js";
import { analyticsOverviewQuerySchema } from "./analytics.validation.js";

export class AnalyticsController {
  static overview = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const query = analyticsOverviewQuerySchema.parse(req.query);
      const overview = await AnalyticsService.overview(
        req.user!.companyId,
        query
      );

      return sendResponse({
        res,
        message: "Analytics overview retrieved successfully",
        data: overview,
      });
    }
  );
}
