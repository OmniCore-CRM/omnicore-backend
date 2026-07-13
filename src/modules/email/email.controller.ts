import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { EmailService } from "./email.service.js";
import { WebhookReplayService } from "@/modules/channels/webhook-replay.service.js";
import { AppError } from "@/core/errors/app-error.js";
import { WebhookProvider } from "@prisma/client";

const getUserContext = (req: AuthenticatedRequest) => ({
  userId: req.user!.userId,
  companyId: req.user!.companyId,
  role: req.user!.role,
});

export class EmailController {
  static listAccounts = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) =>
      sendResponse({
        res,
        message: "Email accounts retrieved successfully",
        data: await EmailService.listAccounts(req.user!.companyId),
      })
  );

  static createAccount = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) =>
      sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Email account created successfully",
        data: await EmailService.createAccount(getUserContext(req), req.body),
      })
  );

  static updateAccount = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) =>
      sendResponse({
        res,
        message: "Email account updated successfully",
        data: await EmailService.updateAccount(
          getUserContext(req),
          req.params.id as string,
          req.body
        ),
      })
  );

  static deleteAccount = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) =>
      sendResponse({
        res,
        message: "Email account deleted successfully",
        data: await EmailService.deleteAccount(
          getUserContext(req),
          req.params.id as string
        ),
      })
  );

  static receiveWebhook = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const rawBody = (req as AuthenticatedRequest & { rawBody?: Buffer }).rawBody;
      const rawPayload = rawBody?.toString("utf8") ?? JSON.stringify(req.body);
      const payloadFingerprint = WebhookReplayService.payloadFingerprint(rawPayload);
      const requestId = (req as AuthenticatedRequest & { requestId?: string }).requestId;
      const signatureHeader =
        (req.headers["svix-signature"] as string | undefined) ||
        (req.headers["x-email-webhook-secret"] as string | undefined) ||
        null;

      try {
        EmailService.verifyWebhookSignature({
          receivedSecret: req.headers["x-email-webhook-secret"] as string | undefined,
          svixId: req.headers["svix-id"] as string | undefined,
          svixTimestamp: req.headers["svix-timestamp"] as string | undefined,
          svixSignature: req.headers["svix-signature"] as string | undefined,
          rawBody,
        });
      } catch (error) {
        await WebhookReplayService.recordSecurityEvent({
          provider: WebhookProvider.EMAIL,
          eventType: "SECURITY_SIGNATURE_FAILED",
          requestId,
          signatureFingerprint:
            WebhookReplayService.signatureFingerprint(signatureHeader),
          payloadFingerprintSource: rawPayload,
          reason:
            error instanceof AppError ? error.message : "signature_verification_failed",
        });
        throw error;
      }

      if (!req.body || typeof req.body !== "object") {
        await WebhookReplayService.recordSecurityEvent({
          provider: WebhookProvider.EMAIL,
          eventType: "SECURITY_TRUST_BOUNDARY_VIOLATION",
          requestId,
          signatureFingerprint:
            WebhookReplayService.signatureFingerprint(signatureHeader),
          payloadFingerprintSource: rawPayload,
          reason: "unsupported_payload_shape",
        });
      }

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Email webhook processed successfully",
        data: await EmailService.processWebhook(req.body),
      });
    }
  );
}
