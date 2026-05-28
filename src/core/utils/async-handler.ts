import type { NextFunction, Request, Response } from "express";

// Wrap async controllers to automatically catch errors
export const asyncHandler =
(
  fn: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<unknown>
) =>
(req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};