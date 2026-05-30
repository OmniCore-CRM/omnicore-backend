import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type RequestWithId = Request & {
  requestId?: string;
};

const isSafeRequestId = (value: string) =>
  /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);

export const requestIdMiddleware = (
  req: RequestWithId,
  res: Response,
  next: NextFunction
) => {
  const incomingRequestId = req.get("x-request-id");
  const requestId =
    incomingRequestId && isSafeRequestId(incomingRequestId)
      ? incomingRequestId
      : crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  next();
};
