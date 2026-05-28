import type { Request, Response } from "express";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { AuthService } from "./auth.service.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import type { AuthenticatedUser } from "./auth.validation.js";

export class AuthController {
  // Register new company + owner account
  static register = asyncHandler(async (req: Request, res: Response) => {
    // Pass validated data into service layer
    const user = await AuthService.register(req.body);

    // Send consistent API response
    return sendResponse({
      res,
      statusCode: HTTP_STATUS.CREATED,
      message: "Account created successfully",
      data: user,
    });
  });

  // Login controller (Login existing user)
  static login = asyncHandler(async (req: Request, res: Response) => {
    // Authenticate user credentials
    const result = await AuthService.login(req.body);

    // Send authenticated response
    return sendResponse({
      res,
      statusCode: HTTP_STATUS.OK,
      message: "Login successful",
      data: result,
    });
  });

  // ===== Return authenticated session user =====
  static me = asyncHandler(
    async (
      req: Request & {
        user?: AuthenticatedUser;
      },
      res: Response
    ) => {
      // Ensure authenticated user exists
      if (!req.user) {
        throw new AppError(
          "Unauthorized",
          HTTP_STATUS.UNAUTHORIZED
        );
      }
      // Fetch authenticated tenant user
      const result = await AuthService.getCurrentUser(
        req.user.userId,
        req.user.companyId
      );

      // Send authenticated session response
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Authenticated user fetched successfully",
        data: result,
      });
    }
  );
}