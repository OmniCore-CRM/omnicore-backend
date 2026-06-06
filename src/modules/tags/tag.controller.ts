import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { TagService } from "./tag.service.js";
import { attachTagSchema, tagListQuerySchema } from "./tag.validation.js";

const getUserContext = (req: AuthenticatedRequest) => ({
  userId: req.user!.userId,
  companyId: req.user!.companyId,
  role: req.user!.role,
});

export class TagController {
  static getTags = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const query = tagListQuerySchema.parse(req.query);
      const tags = await TagService.getTags(req.user!.companyId, query);

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Tags retrieved successfully",
        data: tags,
      });
    }
  );

  static createTag = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const tag = await TagService.createTag(getUserContext(req), req.body);

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Tag created successfully",
        data: tag,
      });
    }
  );

  static updateTag = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const tag = await TagService.updateTag(
        getUserContext(req),
        req.params.id as string,
        req.body
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Tag updated successfully",
        data: tag,
      });
    }
  );

  static deleteTag = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const tag = await TagService.deleteTag(
        getUserContext(req),
        req.params.id as string
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Tag deleted successfully",
        data: tag,
      });
    }
  );

  static attachCustomerTag = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const body = attachTagSchema.parse(req.body);
      const tag = await TagService.attachTag(
        getUserContext(req),
        "customer",
        req.params.id as string,
        body.tagId
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Customer tag attached successfully",
        data: tag,
      });
    }
  );

  static removeCustomerTag = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const tag = await TagService.removeTag(
        getUserContext(req),
        "customer",
        req.params.id as string,
        req.params.tagId as string
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Customer tag removed successfully",
        data: tag,
      });
    }
  );

  static attachConversationTag = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const body = attachTagSchema.parse(req.body);
      const tag = await TagService.attachTag(
        getUserContext(req),
        "conversation",
        req.params.id as string,
        body.tagId
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Conversation tag attached successfully",
        data: tag,
      });
    }
  );

  static removeConversationTag = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const tag = await TagService.removeTag(
        getUserContext(req),
        "conversation",
        req.params.id as string,
        req.params.tagId as string
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Conversation tag removed successfully",
        data: tag,
      });
    }
  );

  static attachTicketTag = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const body = attachTagSchema.parse(req.body);
      const tag = await TagService.attachTag(
        getUserContext(req),
        "ticket",
        req.params.id as string,
        body.tagId
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Ticket tag attached successfully",
        data: tag,
      });
    }
  );

  static removeTicketTag = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const tag = await TagService.removeTag(
        getUserContext(req),
        "ticket",
        req.params.id as string,
        req.params.tagId as string
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Ticket tag removed successfully",
        data: tag,
      });
    }
  );
}
