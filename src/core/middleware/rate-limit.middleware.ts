import type { NextFunction, Request, Response } from "express";
import { HTTP_STATUS } from "@/core/constants/http-status.js";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitEntry>();

const getClientIp = (req: Request) =>
  req.ip ||
  req.socket.remoteAddress ||
  "unknown";

export const rateLimit =
  ({ windowMs, max, keyPrefix }: RateLimitOptions) =>
  (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${keyPrefix}:${getClientIp(req)}`;
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });

      return next();
    }

    current.count += 1;

    if (current.count > max) {
      res.setHeader(
        "Retry-After",
        Math.ceil((current.resetAt - now) / 1000)
      );

      return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        success: false,
        message: "Too many requests",
      });
    }

    return next();
  };
