import type { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { HTTP_STATUS } from "@/core/constants/http-status.js";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
  keyGenerator?: (req: Request) => string | string[];
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

const hashKeyPart = (value: string) =>
  crypto
    .createHash("sha256")
    .update(value)
    .digest("base64url")
    .slice(0, 32);

const getRateLimitKeys = (
  req: Request,
  options: RateLimitOptions
) => {
  const rawKeys = options.keyGenerator
    ? options.keyGenerator(req)
    : getClientIp(req);
  const keys = Array.isArray(rawKeys) ? rawKeys : [rawKeys];

  return Array.from(
    new Set(
      keys
        .map((key) => key.trim())
        .filter(Boolean)
        .map((key) => `${options.keyPrefix}:${hashKeyPart(key)}`)
    )
  );
};

const pruneExpiredBuckets = (now: number) => {
  if (buckets.size < 10_000) return;

  for (const [key, entry] of buckets.entries()) {
    if (entry.resetAt <= now) {
      buckets.delete(key);
    }
  }
};

export const rateLimit =
  (options: RateLimitOptions) =>
  (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    pruneExpiredBuckets(now);

    const keys = getRateLimitKeys(req, options);

    for (const key of keys) {
      const current = buckets.get(key);

      if (!current || current.resetAt <= now) {
        buckets.set(key, {
          count: 1,
          resetAt: now + options.windowMs,
        });
        continue;
      }

      current.count += 1;

      if (current.count > options.max) {
        res.setHeader(
          "Retry-After",
          Math.ceil((current.resetAt - now) / 1000)
        );

        const requestId = (req as Request & { requestId?: string }).requestId;

        return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
          success: false,
          message: "Too many requests",
          requestId,
        });
      }
    }

    return next();
  };
