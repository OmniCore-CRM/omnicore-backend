import type { NextFunction, Response } from "express";
import type { RequestWithId } from "./request-id.middleware.js";
import {
  runWithRequestProfile,
  isApiProfilingEnabled,
} from "@/core/profiling/request-profiler.js";

export const requestProfileMiddleware = (
  req: RequestWithId,
  _res: Response,
  next: NextFunction,
) => {
  if (!isApiProfilingEnabled()) {
    next();
    return;
  }

  runWithRequestProfile(req.requestId ?? "unknown-request", () => next());
};
