import type { NextFunction, Response } from "express";
import type { RequestWithId } from "./request-id.middleware.js";

export const accessLogMiddleware = (
  req: RequestWithId,
  res: Response,
  next: NextFunction
) => {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    console.log(JSON.stringify({
      level: "info",
      event: "http_request",
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
    }));
  });

  next();
};
