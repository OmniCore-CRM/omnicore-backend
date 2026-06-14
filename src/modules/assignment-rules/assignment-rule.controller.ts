import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { AssignmentRuleService } from "./assignment-rule.service.js";

const context = (req: AuthenticatedRequest) => ({
  userId: req.user!.userId,
  companyId: req.user!.companyId,
  role: req.user!.role,
});

export class AssignmentRuleController {
  static list = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({
      res,
      message: "Assignment rules retrieved successfully",
      data: await AssignmentRuleService.list(req.user!.companyId),
    })
  );

  static create = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({
      res,
      statusCode: HTTP_STATUS.CREATED,
      message: "Assignment rule created successfully",
      data: await AssignmentRuleService.create(context(req), req.body),
    })
  );

  static update = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({
      res,
      message: "Assignment rule updated successfully",
      data: await AssignmentRuleService.update(
        context(req),
        req.params.id as string,
        req.body
      ),
    })
  );

  static delete = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({
      res,
      message: "Assignment rule deleted successfully",
      data: await AssignmentRuleService.delete(
        context(req),
        req.params.id as string
      ),
    })
  );
}
