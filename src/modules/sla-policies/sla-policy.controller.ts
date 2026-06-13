import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { SlaPolicyService } from "./sla-policy.service.js";

const userContext = (req: AuthenticatedRequest) => ({
  userId: req.user!.userId,
  companyId: req.user!.companyId,
  role: req.user!.role,
});

export class SlaPolicyController {
  static list = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "SLA policies retrieved successfully",
      data: await SlaPolicyService.list(req.user!.companyId),
    })
  );

  static create = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({
      res,
      statusCode: HTTP_STATUS.CREATED,
      message: "SLA policy created successfully",
      data: await SlaPolicyService.create(userContext(req), req.body),
    })
  );

  static update = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "SLA policy updated successfully",
      data: await SlaPolicyService.update(
        userContext(req),
        req.params.id as string,
        req.body
      ),
    })
  );

  static delete = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "SLA policy deleted successfully",
      data: await SlaPolicyService.delete(userContext(req), req.params.id as string),
    })
  );
}
