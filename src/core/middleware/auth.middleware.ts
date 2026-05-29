import type {
  NextFunction,
  Request,
  Response,
} from "express";
import jwt from "jsonwebtoken";
import { env } from "@/config/env.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";

// JWT authentication payload structure
interface JwtPayload {
  userId: string;
  companyId: string;
  role: string;
}

// Extend Express request object
export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

// Protect authenticated routes
export const protect = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) => {
  const authorizationHeader = req.headers.authorization;

  // Ensure token exists
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new AppError(
      "Unauthorized access",
      HTTP_STATUS.UNAUTHORIZED
    );
  }

  // Extract JWT token
  const token = authorizationHeader.split(" ")[1];

  try {
    // Verify and decode token
    const decoded = jwt.verify(
      token,
      env.JWT_SECRET
    ) as JwtPayload;

    // Attach authenticated user to request
    req.user = decoded;

    next();
  } catch (error) {
    // Handle expired JWT tokens
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(
        "Token expired",
        HTTP_STATUS.UNAUTHORIZED
      );
    }

    // Handle malformed or invalid JWT tokens
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AppError(
        "Invalid token",
        HTTP_STATUS.UNAUTHORIZED
      );
    }

    // Fallback authentication failure
    throw new AppError(
      "Authentication failed",
      HTTP_STATUS.UNAUTHORIZED
    );
  }
};
