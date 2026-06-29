import type { Request, Response } from "express";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { WidgetService } from "./widget.service.js";
import {
  widgetBootstrapQuerySchema,
  widgetMessagesQuerySchema,
} from "./widget.validation.js";
import { AppError } from "@/core/errors/app-error.js";

const getRequestOrigin = (req: Request) =>
  req.get("origin") || req.get("referer");

const assertWidgetAdmin = (req: AuthenticatedRequest) => {
  const role = req.user?.role;
  if (!["SUPER_ADMIN", "OWNER", "ADMIN"].includes(role ?? "")) {
    throw new AppError(
      "Widget settings are restricted to workspace admins",
      HTTP_STATUS.FORBIDDEN
    );
  }
};

export class WidgetController {
  static getInstallations = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);

      const installations = await WidgetService.getInstallations(
        req.user!.companyId
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Widget installations retrieved successfully",
        data: installations,
      });
    }
  );

  static createInstallation = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);

      const installation = await WidgetService.createInstallation(
        req.user!.companyId,
        req.body,
        req.user!.userId
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Widget installation created successfully",
        data: installation,
      });
    }
  );

  static updateInstallation = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      assertWidgetAdmin(req);

      const installation = await WidgetService.updateInstallation(
        req.user!.companyId,
        req.params.id as string,
        req.body,
        req.user!.userId
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Widget installation updated successfully",
        data: installation,
      });
    }
  );

  static bootstrap = asyncHandler(
    async (req: Request, res: Response) => {
      const query = widgetBootstrapQuerySchema.parse(req.query);
      const config = await WidgetService.bootstrap(
        query.key,
        getRequestOrigin(req)
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Widget bootstrap retrieved successfully",
        data: config,
      });
    }
  );

  // ===== Create public widget conversation =====
  static createWidgetConversation = asyncHandler(
    async (req: Request, res: Response) => {
      // Create widget conversation flow
      const result = await WidgetService.createWidgetConversation(
        req.body,
        getRequestOrigin(req)
      );

      // Send successful API response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Widget conversation created successfully",
        data: result,
      });
    }
  );

  static getWidgetMessages = asyncHandler(
    async (req: Request, res: Response) => {
      const query = widgetMessagesQuerySchema.parse(req.query);
      const messages = await WidgetService.getConversationMessages(
        req.params.id as string,
        query,
        getRequestOrigin(req)
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Widget messages retrieved successfully",
        data: messages,
      });
    }
  );

  // ===== Send public widget message =====
  static createWidgetMessage = asyncHandler(
    async (req: Request, res: Response) => {
      // Create widget message
      const message = await WidgetService.createWidgetMessage(
        req.params.id as string,
        req.body,
        getRequestOrigin(req)
      );

      // Send successful API response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Widget message created successfully",
        data: message,
      });
    }
  );
}
