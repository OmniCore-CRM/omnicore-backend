import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

// Reusable request validation middleware
export const validateRequest =
  (schema: ZodType) =>
  (req: Request, _res: Response, next: NextFunction) => {
    // Validate incoming request body
    const validatedData = schema.parse(req.body);

    // Replace req.body with validated data
    req.body = validatedData;

    next();
  };