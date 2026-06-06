import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { protect } from "@/core/middleware/auth.middleware.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import { AttachmentService } from "./attachment.service.js";

const getOrigin = (req: Request) => req.get("origin") || req.get("referer");

const requireFile = (req: Request) => {
  if (!req.file) {
    throw new AppError("Attachment file is required", HTTP_STATUS.BAD_REQUEST);
  }
  return req.file;
};

const agentContext = (req: AuthenticatedRequest) => ({
  userId: req.user!.userId,
  companyId: req.user!.companyId,
  role: req.user!.role,
});

export const optionalProtect = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.headers.authorization) return next();
  return protect(req, res, next);
};

export class AttachmentController {
  static upload = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const attachment = await AttachmentService.uploadAgentAttachment(
        agentContext(req),
        requireFile(req),
        {
          conversationId:
            (req.params.conversationId as string | undefined) ||
            (req.body.conversationId as string | undefined),
          messageId:
            (req.params.messageId as string | undefined) ||
            (req.body.messageId as string | undefined),
          ticketId:
            (req.params.ticketId as string | undefined) ||
            (req.body.ticketId as string | undefined),
        }
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Attachment uploaded successfully",
        data: attachment,
      });
    }
  );

  static uploadWidget = asyncHandler(async (req: Request, res: Response) => {
    const attachment = await AttachmentService.uploadWidgetAttachment(
      requireFile(req),
      {
        publicKey: String(req.body.publicKey ?? ""),
        sessionToken: String(req.body.sessionToken ?? ""),
        conversationId: req.params.conversationId as string,
        requestOrigin: getOrigin(req),
      }
    );

    return sendResponse({
      res,
      statusCode: HTTP_STATUS.CREATED,
      message: "Attachment uploaded successfully",
      data: attachment,
    });
  });

  static download = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const attachmentId = req.params.id as string;
      const result = req.user
        ? await AttachmentService.getAgentDownload(
            req.user.companyId,
            attachmentId
          )
        : await AttachmentService.getWidgetDownload(attachmentId, {
            publicKey: String(req.get("x-widget-key") ?? ""),
            sessionToken: String(req.get("x-widget-session") ?? ""),
            requestOrigin: getOrigin(req),
          });

      res.setHeader("Content-Type", result.attachment.mimeType);
      res.setHeader("Content-Length", result.attachment.fileSize);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(
          result.attachment.fileName
        )}`
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(result.buffer);
    }
  );
}
