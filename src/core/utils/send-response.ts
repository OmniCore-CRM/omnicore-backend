import type { Response } from "express";

interface SendResponseOptions<T> {
  res: Response;
  statusCode?: number;
  success?: boolean;
  message: string;
  data?: T;
}

// Centralized API response formatter
export const sendResponse = <T>({
  res,
  statusCode = 200,
  success = true,
  message,
  data,
}: SendResponseOptions<T>) => {
  return res.status(statusCode).json({
    success,
    message,
    data,
  });
};