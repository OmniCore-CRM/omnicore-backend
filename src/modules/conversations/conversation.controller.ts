import type { Response } from "express";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { ConversationService } from "./conversation.service.js";
import { parsePaginationQuery } from "@/core/utils/pagination.js";

export class ConversationController {
  // ===== Create tenant-scoped conversation =====
  static createConversation = asyncHandler(
    async (
      req: AuthenticatedRequest,
      res: Response
    ) => {
      // companyId comes from authenticated JWT context
      const companyId = req.user!.companyId;

      // Create tenant-scoped conversation
      const conversation = await ConversationService.createConversation(
        companyId,
        req.body
      );

      // Send successful API response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Conversation created successfully",
        data: conversation,
      });
    }
  );

  // ===== Fetch conversations belonging to authenticated tenant =====
  static getConversations = asyncHandler(
    async (
      req: AuthenticatedRequest,
      res: Response
    ) => {

    // companyId comes from authenticated JWT context
    const companyId = req.user!.companyId;

    const pagination = parsePaginationQuery(req.query);

    // Fetch tenant-scoped conversations
    const conversations = await ConversationService.getConversations(
      companyId,
      {
        ...pagination,
        search: req.query.search,
        channel: req.query.channel,
      }
    );

    // Send successful API response
    return sendResponse({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Conversations retrieved successfully",
      data: conversations,
    });
  });

  // ===== Fetch single tenant-scoped conversation =====
  static getConversationById = asyncHandler(
    async (
      req: AuthenticatedRequest,
      res: Response
    ) => {
      // companyId comes from authenticated JWT context
      const companyId = req.user!.companyId;

      // Route params may technically infer string[]
      const id = req.params.id as string;

      // Fetch tenant-scoped conversation
      const conversation = await ConversationService.getConversationById(
        companyId,
        id
      );

      // Send successful API response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Conversation retrieved successfully",
        data: conversation,
      });
    }
  );

  // ===== Placeholder conversation read handler =====
  static markConversationAsRead = asyncHandler(
    async (
      req: AuthenticatedRequest,
      res: Response
    ) => {
      
      // companyId comes from authenticated JWT context
      const companyId = req.user!.companyId;

      // Route params may technically infer string[]
      const id = req.params.id as string;

      // Mark conversation as read
      const result = await ConversationService.markConversationAsRead(
        companyId,
        id
      );

      // Send successful API response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Conversation marked as read",
        data: result,
      });
    }
  );
}
