import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { assignmentCenterOverviewQuerySchema } from "./assignment-center.validation.js";
import { AssignmentCenterService } from "./assignment-center.service.js";

export class AssignmentCenterController {
  static overview = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const query = assignmentCenterOverviewQuerySchema.parse(req.query);
    const data = await AssignmentCenterService.overview(req.user!, query);

    return sendResponse({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Assignment center overview retrieved successfully",
      data,
    });
  });
}
