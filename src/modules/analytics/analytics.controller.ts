import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import {
  AnalyticsService,
  type AnalyticsOverviewCacheDiagnostics,
} from "./analytics.service.js";
import { analyticsOverviewQuerySchema } from "./analytics.validation.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";

const analyticsProcessBootId = randomUUID().replace(/-/g, "").slice(0, 12);

export class AnalyticsController {
  static overview = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const requestStartedAt = Date.now();
      const requestId =
        (req as AuthenticatedRequest & { requestId?: string }).requestId ?? null;

      let cacheDiagnostics: AnalyticsOverviewCacheDiagnostics = {
        cacheHit: false,
        keyHash: "unknown",
        cacheEntryAgeMs: null,
      };

      res.on("finish", () => {
        console.info(
          JSON.stringify({
            level: "info",
            event: "analytics_overview_cache_diagnostics",
            requestId,
            cacheHit: cacheDiagnostics.cacheHit,
            keyHash: cacheDiagnostics.keyHash,
            processBootId: analyticsProcessBootId,
            cacheEntryAgeMs: cacheDiagnostics.cacheEntryAgeMs,
            totalRequestMs: Date.now() - requestStartedAt,
            status: res.statusCode,
          })
        );
      });

      const query = analyticsOverviewQuerySchema.parse(req.query);
      const overview = await AnalyticsService.overview(
        req.user!.companyId,
        query,
        {
          onCacheDiagnostics: (diagnostics) => {
            cacheDiagnostics = diagnostics;
          },
        }
      );

      res.setHeader("X-Analytics-Cache", cacheDiagnostics.cacheHit ? "hit" : "miss");
      res.setHeader("X-Analytics-Key-Hash", cacheDiagnostics.keyHash);
      res.setHeader("X-Analytics-Process-Boot-Id", analyticsProcessBootId);

      await AuditLogService.record({
        companyId: req.user!.companyId,
        actorId: req.user!.userId,
        action: "ANALYTICS_OVERVIEW_VIEWED",
        entityType: "ANALYTICS",
        entityId: req.user!.companyId,
        metadata: {
          range: overview.range,
          from: overview.period.from,
          to: overview.period.to,
          appliedFilters: overview.filters,
        },
      });

      return sendResponse({
        res,
        message: "Analytics overview retrieved successfully",
        data: overview,
      });
    }
  );
}
