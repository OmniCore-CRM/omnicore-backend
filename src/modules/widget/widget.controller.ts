import type { Request, Response } from "express";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { WidgetService } from "./widget.service.js";

export class WidgetController {
  // ===== Create public widget conversation =====
  static createWidgetConversation = asyncHandler(
    async (req: Request, res: Response) => {
      // Create widget conversation flow
      const result = await WidgetService.createWidgetConversation(req.body);

      // Send successful API response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Widget conversation created successfully",
        data: result,
      });
    }
  );

  // ===== Send public widget message =====
  static createWidgetMessage = asyncHandler(
    async (req: Request, res: Response) => {
      // Create widget message
      const message = await WidgetService.createWidgetMessage(req.body);

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