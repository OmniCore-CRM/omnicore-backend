import type { Response } from "express";
import { UserRole } from "@prisma/client";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { UserService } from "./user.service.js";
import { userListQuerySchema } from "./user.validation.js";

export class UserController {
  static getCompanyUsers = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const query = userListQuerySchema.parse(req.query);
      const users = await UserService.getCompanyUsers(
        req.user!.companyId,
        query,
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Users retrieved successfully",
        data: users,
      });
    }
  );

  static createCompanyUser = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const user = await UserService.createCompanyUser({
        actorId: req.user!.userId,
        actorRole: req.user!.role as UserRole,
        companyId: req.user!.companyId,
        data: req.body,
      });

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "User created successfully",
        data: user,
      });
    },
  );

  static updateCompanyUser = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const user = await UserService.updateCompanyUser({
        actorId: req.user!.userId,
        actorUserId: req.user!.userId,
        actorRole: req.user!.role as UserRole,
        companyId: req.user!.companyId,
        userId: req.params.id as string,
        data: req.body,
      });

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "User updated successfully",
        data: user,
      });
    },
  );

  static updateCompanyUserStatus = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const user = await UserService.updateCompanyUserStatus({
        actorId: req.user!.userId,
        actorUserId: req.user!.userId,
        actorRole: req.user!.role as UserRole,
        companyId: req.user!.companyId,
        userId: req.params.id as string,
        data: req.body,
      });

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "User status updated successfully",
        data: user,
      });
    },
  );

  static sendCompanyUserInvite = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const user = await UserService.sendCompanyUserInvite({
        actorId: req.user!.userId,
        actorUserId: req.user!.userId,
        actorRole: req.user!.role as UserRole,
        companyId: req.user!.companyId,
        userId: req.params.id as string,
        mode: "invite",
      });

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Invite sent successfully",
        data: user,
      });
    },
  );

  static resendCompanyUserInvite = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const user = await UserService.sendCompanyUserInvite({
        actorId: req.user!.userId,
        actorUserId: req.user!.userId,
        actorRole: req.user!.role as UserRole,
        companyId: req.user!.companyId,
        userId: req.params.id as string,
        mode: "resend",
      });

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Invite resent successfully",
        data: user,
      });
    },
  );

  static revokeCompanyUserInvite = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const user = await UserService.revokeCompanyUserInvite({
        actorId: req.user!.userId,
        actorUserId: req.user!.userId,
        actorRole: req.user!.role as UserRole,
        companyId: req.user!.companyId,
        userId: req.params.id as string,
      });

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Invite revoked successfully",
        data: user,
      });
    },
  );
}
