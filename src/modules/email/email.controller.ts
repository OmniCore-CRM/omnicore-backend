import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { EmailService } from "./email.service.js";

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
      EmailService.verifyWebhookSignature({
        receivedSecret: req.headers["x-email-webhook-secret"] as string | undefined,
        svixId: req.headers["svix-id"] as string | undefined,
        svixTimestamp: req.headers["svix-timestamp"] as string | undefined,
        svixSignature: req.headers["svix-signature"] as string | undefined,
        rawBody: (req as AuthenticatedRequest & { rawBody?: Buffer }).rawBody,
      });
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Email webhook processed successfully",
        data: await EmailService.processWebhook(req.body),
      });
    }
  );
}
