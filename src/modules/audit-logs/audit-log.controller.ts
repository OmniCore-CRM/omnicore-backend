import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { AuditLogService } from "./audit-log.service.js";
import { auditLogListQuerySchema } from "./audit-log.validation.js";

export class AuditLogController {
  static list = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const query = auditLogListQuerySchema.parse(req.query);
      const logs = await AuditLogService.list(req.user!.companyId, query);

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Audit logs retrieved successfully",
        data: logs,
      });
    }
  );
}
