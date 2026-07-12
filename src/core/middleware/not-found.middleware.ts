import type { Request, Response } from "express";

// Handle unknown routes
export const notFoundHandler = (
  req: Request,
  res: Response
) => {
  const requestId = (req as Request & { requestId?: string }).requestId;

  return res.status(404).json({
    success: false,
    message: "Route not found",
    requestId,
  });
};