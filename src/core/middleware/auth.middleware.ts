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

      const [session] = await prisma.$queryRaw<
        {
          sessionId: string;
          userId: string;
          companyId: string;
          role: string;
          userIsActive: boolean;
          userStatus: string;
          companyIsActive: boolean;
        }[]
      >`
        SELECT
          s."id" AS "sessionId",
          s."userId" AS "userId",
          s."companyId" AS "companyId",
          u."role"::text AS "role",
          u."isActive" AS "userIsActive",
          u."status"::text AS "userStatus",
          c."isActive" AS "companyIsActive"
        FROM "AuthSession" s
        JOIN "User" u
          ON u."id" = s."userId"
         AND u."companyId" = s."companyId"
        JOIN "Company" c
          ON c."id" = s."companyId"
        WHERE s."id" = ${decoded.sessionId}
          AND s."userId" = ${decoded.userId}
          AND s."companyId" = ${decoded.companyId}
          AND s."revokedAt" IS NULL
          AND s."expiresAt" > NOW()
        LIMIT 1
      `;

      if (
        !session?.userIsActive ||
        session.userStatus !== "ACTIVE" ||
        !session.companyIsActive
      ) {
        throw unauthorized("Session expired");
      }

      req.user = {
        userId: session.userId,
        companyId: session.companyId,
        role: session.role as AccessTokenPayload["role"],
        sessionId: session.sessionId,
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
