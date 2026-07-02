import type { NextFunction, Response } from "express";
import type { RequestWithId } from "./request-id.middleware.js";
import {
  getRequestProfileSnapshot,
  isApiProfilingEnabled,
} from "@/core/profiling/request-profiler.js";

export const accessLogMiddleware = (
  req: RequestWithId,
  res: Response,
  next: NextFunction
) => {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const contentLength = res.getHeader("content-length");
    const responseBytes =
      typeof contentLength === "number"
        ? contentLength
        : Number.parseInt(String(contentLength ?? "0"), 10) || 0;

    const requestProfile = isApiProfilingEnabled()
      ? getRequestProfileSnapshot()
      : null;

    console.log(JSON.stringify({
      level: "info",
      event: "http_request",
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      responseBytes,
      ...(requestProfile
        ? {
            dbQueryCount: requestProfile.queryCount,
            dbDurationMs: requestProfile.totalDbDurationMs,
            slowQueries: requestProfile.slowQueries,
          }
        : {}),
    }));
  });

  next();
};
