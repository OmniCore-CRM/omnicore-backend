import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { notificationListQuerySchema } from "./notification.validation.js";
import { NotificationService } from "./notification.service.js";

export class NotificationController {
  static list = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const query = notificationListQuerySchema.parse(req.query);
    const notifications = await NotificationService.listNotifications(
      req.user!.companyId,
      req.user!.userId,
      query,
    );

    return sendResponse({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Notifications retrieved successfully",
      data: notifications,
    });
  });

  static unreadCount = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const count = await NotificationService.unreadCount(
        req.user!.companyId,
        req.user!.userId,
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Unread notification count retrieved successfully",
        data: count,
      });
    },
  );

  static markRead = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const notification = await NotificationService.markRead(
        req.user!.companyId,
        req.user!.userId,
        req.params.id as string,
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Notification marked as read",
        data: notification,
      });
    },
  );

  static markUnread = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const notification = await NotificationService.markUnread(
        req.user!.companyId,
        req.user!.userId,
        req.params.id as string,
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Notification marked as unread",
        data: notification,
      });
    },
  );

  static markAllRead = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const result = await NotificationService.markAllRead(
        req.user!.companyId,
        req.user!.userId,
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "All notifications marked as read",
        data: result,
      });
    },
  );
}
