import type { Response } from "express";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { MessageService } from "./message.service.js";
import { parsePaginationQuery } from "@/core/utils/pagination.js";

export class MessageController {
  // ===== Create tenant-scoped message =====
  static createMessage = asyncHandler(
    async (
      req: AuthenticatedRequest,
      res: Response
    ) => {
      // companyId comes from authenticated JWT context
      const companyId = req.user!.companyId;

      // Create tenant-scoped message
      const message = await MessageService.createMessage(
        companyId,
        req.body
      );

      // Send successful API response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Message created successfully",
        data: message,
      });
    }
  );

  // ===== Fetch messages belonging to tenant conversation =====
  static getConversationMessages = asyncHandler(
    async (
      req: AuthenticatedRequest,
      res: Response
    ) => {
      // companyId comes from authenticated JWT context
      const companyId = req.user!.companyId;

      // Extract conversation ID from route params
      const conversationId = req.params.id as string;
      const pagination = parsePaginationQuery(req.query);

      // Fetch tenant-scoped conversation messages
      const messages = await MessageService.getConversationMessages(
        companyId,
        conversationId,
        pagination
      );

      // Send successful API response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Messages retrieved successfully",
        data: messages,
      });
    }
  );
}
