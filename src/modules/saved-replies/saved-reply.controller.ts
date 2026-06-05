import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { SavedReplyService } from "./saved-reply.service.js";
import { savedReplyListQuerySchema } from "./saved-reply.validation.js";

const getUserContext = (req: AuthenticatedRequest) => ({
  userId: req.user!.userId,
  companyId: req.user!.companyId,
  role: req.user!.role,
});

export class SavedReplyController {
  static getSavedReplies = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const query = savedReplyListQuerySchema.parse(req.query);
      const replies = await SavedReplyService.getSavedReplies(
        req.user!.companyId,
        query
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Saved replies retrieved successfully",
        data: replies,
      });
    }
  );

  static createSavedReply = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const reply = await SavedReplyService.createSavedReply(
        getUserContext(req),
        req.body
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Saved reply created successfully",
        data: reply,
      });
    }
  );

  static updateSavedReply = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const reply = await SavedReplyService.updateSavedReply(
        getUserContext(req),
        req.params.id as string,
        req.body
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Saved reply updated successfully",
        data: reply,
      });
    }
  );

  static deleteSavedReply = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const reply = await SavedReplyService.deleteSavedReply(
        getUserContext(req),
        req.params.id as string
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Saved reply deleted successfully",
        data: reply,
      });
    }
  );
}
