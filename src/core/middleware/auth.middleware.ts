import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "@/config/db.js";
import { env } from "@/config/env.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import type { AccessTokenPayload } from "@/modules/auth/auth.utils.js";

export interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}

const unauthorized = (message: string) =>
  new AppError(message, HTTP_STATUS.UNAUTHORIZED);

export const protect = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) => {
  void (async () => {
    const authorizationHeader = req.headers.authorization;

    if (!authorizationHeader?.startsWith("Bearer ")) {
      throw unauthorized("Unauthorized access");
    }

    const token = authorizationHeader.split(" ")[1];

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;

      if (
        !decoded.userId ||
        !decoded.companyId ||
        !decoded.role ||
        !decoded.sessionId
      ) {
        throw unauthorized("Invalid token");
      }

      const session = await prisma.authSession.findFirst({
        where: {
          id: decoded.sessionId,
          userId: decoded.userId,
          companyId: decoded.companyId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: {
          user: {
            select: {
              id: true,
              companyId: true,
              role: true,
              isActive: true,
              company: { select: { id: true, isActive: true } },
            },
          },
        },
      });

      if (!session?.user.isActive || !session.user.company.isActive) {
        throw unauthorized("Session expired");
      }

      req.user = {
        userId: session.user.id,
        companyId: session.user.companyId,
        role: session.user.role,
        sessionId: session.id,
      };

      next();
    } catch (error) {
      if (error instanceof AppError) throw error;

      if (error instanceof jwt.TokenExpiredError) {
        throw unauthorized("Token expired");
      }

      if (error instanceof jwt.JsonWebTokenError) {
        throw unauthorized("Invalid token");
      }

      throw unauthorized("Authentication failed");
    }
  })().catch(next);
};
