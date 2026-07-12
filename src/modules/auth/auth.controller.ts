import type { Request, Response } from "express";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { AuthService } from "./auth.service.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import type { AuthenticatedUser } from "./auth.validation.js";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import {
  clearRefreshCookie,
  REFRESH_COOKIE_NAME,
  setRefreshCookie,
} from "./auth.utils.js";
import { validateInviteQuerySchema } from "./auth.validation.js";

const sendIssuedAuth = ({
  res,
  statusCode,
  message,
  issued,
}: {
  res: Response;
  statusCode: number;
  message: string;
  issued: Awaited<ReturnType<typeof AuthService.login>>;
}) => {
  setRefreshCookie(res, issued.refreshToken, issued.refreshExpiresAt);

  return sendResponse({
    res,
    statusCode,
    message,
    data: issued.auth,
  });
};

export class AuthController {
  static register = asyncHandler(async (req: Request, res: Response) => {
    const issued = await AuthService.register(req.body);

    return sendIssuedAuth({
      res,
      statusCode: HTTP_STATUS.CREATED,
      message: "Account created successfully",
      issued,
    });
  });

  static login = asyncHandler(async (req: Request, res: Response) => {
    const issued = await AuthService.login(req.body);

    return sendIssuedAuth({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Login successful",
      issued,
    });
  });

  static forgotPassword = asyncHandler(async (req: Request, res: Response) => {
    await AuthService.forgotPassword(req.body);

    return sendResponse({
      res,
      statusCode: HTTP_STATUS.OK,
      message:
        "If an account exists for that email, a password reset link has been sent",
    });
  });

  static resetPassword = asyncHandler(async (req: Request, res: Response) => {
    await AuthService.resetPassword(req.body);

    return sendResponse({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Password reset successful",
    });
  });

  static validateInvite = asyncHandler(async (req: Request, res: Response) => {
    const { token } = validateInviteQuerySchema.parse(req.query);
    const invite = await AuthService.validateInviteToken(token);

    return sendResponse({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Invite token is valid",
      data: invite,
    });
  });

  static acceptInvite = asyncHandler(async (req: Request, res: Response) => {
    const accepted = await AuthService.acceptInvite(req.body);

    return sendResponse({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Invite accepted successfully",
      data: accepted,
    });
  });

  static refresh = asyncHandler(async (req: Request, res: Response) => {
    const issued = await AuthService.refresh(req.cookies?.[REFRESH_COOKIE_NAME]);

    return sendIssuedAuth({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Session refreshed successfully",
      issued,
    });
  });

  static logout = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await AuthService.logout({
      refreshToken: req.cookies?.[REFRESH_COOKIE_NAME],
      sessionId: req.user?.sessionId,
    });
    clearRefreshCookie(res);

    return sendResponse({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Logged out successfully",
    });
  });

  static me = asyncHandler(
    async (
      req: Request & { user?: AuthenticatedUser },
      res: Response
    ) => {
      if (!req.user) {
        throw new AppError("Unauthorized", HTTP_STATUS.UNAUTHORIZED);
      }

      const result = await AuthService.getCurrentUser(
        req.user.userId,
        req.user.companyId
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Authenticated user fetched successfully",
        data: result,
      });
    }
  );

  static updateMe = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const result = await AuthService.updateCurrentUserProfile({
        userId: req.user!.userId,
        companyId: req.user!.companyId,
        displayName: req.body.displayName,
      });

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Profile updated successfully",
        data: result,
      });
    },
  );
}
