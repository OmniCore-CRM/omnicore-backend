import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { UserService } from "./user.service.js";

export class UserController {
  static getCompanyUsers = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const users = await UserService.getCompanyUsers(
        req.user!.companyId
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Users retrieved successfully",
        data: users,
      });
    }
  );
}
