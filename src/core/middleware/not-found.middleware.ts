import type { Request, Response } from "express";

// Handle unknown routes
export const notFoundHandler = (
  req: Request,
  res: Response
) => {
  return res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
};