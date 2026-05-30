import type { NextFunction, Request, Response } from "express";
import { AppError } from "@/core/errors/app-error.js";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import type { RequestWithId } from "./request-id.middleware.js";

// Global error handler
export const globalErrorHandler = (
  error: Error,
  req: RequestWithId,
  res: Response,
  _next: NextFunction
) => {
  // Handle custom app errors
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
      details: error.details,
      requestId: req.requestId,
    });
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const formattedErrors: Record<string, string[]> = {};

    error.issues.forEach((issue) => {
      const field = issue.path.join(".");

      if (!formattedErrors[field]) {
        formattedErrors[field] = [];
      }

      formattedErrors[field].push(issue.message);
    });

    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      message: "Validation failed",
      errors: formattedErrors,
      requestId: req.requestId,
    });
  }

  // Handle Prisma known request errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Unique constraints violation
    if (error.code === "P2002") {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: "Resource already exists",
        requestId: req.requestId,
      });
    }
  }

  // Handle Prisma validation errors
  if (error instanceof Prisma.PrismaClientValidationError) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      message: "Invalid database query",
      requestId: req.requestId,
    });
  }

  console.error(JSON.stringify({
    level: "error",
    event: "unhandled_error",
    requestId: req.requestId,
    message: error.message,
    stack: process.env.NODE_ENV === "production"
      ? undefined
      : error.stack,
  }));

  // Fallback for unexpected errors
  return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: "Internal server error",
    requestId: req.requestId,
  });
};
