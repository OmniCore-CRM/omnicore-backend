import bcrypt from "bcrypt";
import type { Company, Prisma, User } from "@prisma/client";
import { prisma } from "@/config/db.js";
import type { RegisterInput, LoginInput } from "./auth.validation.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import {
  createRefreshExpiry,
  createRefreshToken,
  generateAccessToken,
  hashRefreshToken,
} from "./auth.utils.js";
import { mapAuthResponse } from "./auth.mapper.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";

type UserWithCompany = User & { company: Company };
type IssuedAuth = {
  auth: ReturnType<typeof mapAuthResponse>;
  refreshToken: string;
  refreshExpiresAt: Date;
};

const invalidSessionError = () =>
  new AppError("Session expired", HTTP_STATUS.UNAUTHORIZED);

export class AuthService {
  private static async issueSession(
    tx: Prisma.TransactionClient,
    user: Pick<User, "id" | "companyId" | "role">
  ) {
    const refreshToken = createRefreshToken();
    const refreshExpiresAt = createRefreshExpiry();
    const session = await tx.authSession.create({
      data: {
        userId: user.id,
        companyId: user.companyId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: refreshExpiresAt,
      },
      select: { id: true },
    });

    return {
      refreshToken,
      refreshExpiresAt,
      accessToken: generateAccessToken({
        userId: user.id,
        companyId: user.companyId,
        role: user.role,
        sessionId: session.id,
      }),
    };
  }

  private static assertActive(user: UserWithCompany) {
    if (!user.isActive || !user.company.isActive) {
      throw invalidSessionError();
    }
  }

  private static toIssuedAuth(
    user: UserWithCompany,
    issued: Awaited<ReturnType<typeof AuthService.issueSession>>
  ): IssuedAuth {
    return {
      auth: mapAuthResponse({
        accessToken: issued.accessToken,
        user,
        company: user.company,
      }),
      refreshToken: issued.refreshToken,
      refreshExpiresAt: issued.refreshExpiresAt,
    };
  }

  // ===== Register new company owner =====
  static async register(data: RegisterInput): Promise<IssuedAuth> {
    const { companyName, firstName, lastName, email, password } = data;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new AppError(
        "User with this email already exists",
        HTTP_STATUS.CONFLICT
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name: companyName } });
      const user = await tx.user.create({
        data: {
          firstName,
          lastName,
          email,
          passwordHash,
          role: "OWNER",
          companyId: company.id,
        },
        include: { company: true },
      });
      const issued = await this.issueSession(tx, user);
      return { user, issued };
    });

    return this.toIssuedAuth(result.user, result.issued);
  }

  // ===== Login Logic (Authenticate existing user) =====
  static async login(data: LoginInput): Promise<IssuedAuth> {
    const { email, password } = data;

    const user = await prisma.user.findUnique({
      where: { email },
      include: { company: true },
    });

    if (!user) {
      throw new AppError("Invalid email or password", HTTP_STATUS.UNAUTHORIZED);
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordCorrect) {
      throw new AppError("Invalid email or password", HTTP_STATUS.UNAUTHORIZED);
    }

    this.assertActive(user);

    const issued = await prisma.$transaction(async (tx) =>
      this.issueSession(tx, user)
    );

    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.id,
      action: "USER_LOGIN",
      entityType: "USER",
      entityId: user.id,
      metadata: { role: user.role },
    });

    return this.toIssuedAuth(user, issued);
  }

  static async refresh(refreshToken: string | undefined): Promise<IssuedAuth> {
    if (!refreshToken) throw invalidSessionError();

    const now = new Date();
    const tokenHash = hashRefreshToken(refreshToken);
    const session = await prisma.authSession.findUnique({
      where: { tokenHash },
      include: { user: { include: { company: true } } },
    });

    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw invalidSessionError();
    }

    this.assertActive(session.user);

    const nextRefreshToken = createRefreshToken();
    const nextRefreshExpiresAt = createRefreshExpiry();
    const updated = await prisma.authSession.update({
      where: { id: session.id },
      data: {
        tokenHash: hashRefreshToken(nextRefreshToken),
        expiresAt: nextRefreshExpiresAt,
      },
      select: { id: true },
    });

    const accessToken = generateAccessToken({
      userId: session.user.id,
      companyId: session.user.companyId,
      role: session.user.role,
      sessionId: updated.id,
    });

    void AuditLogService.record({
      companyId: session.user.companyId,
      actorId: session.user.id,
      action: "USER_SESSION_REFRESHED",
      entityType: "AUTH_SESSION",
      entityId: updated.id,
      metadata: {
        userId: session.user.id,
      },
    }).catch(() => {
      console.error(
        JSON.stringify({
          level: "error",
          event: "audit_log_write_failed",
          action: "USER_SESSION_REFRESHED",
          companyId: session.user.companyId,
          entityId: updated.id,
        }),
      );
    });

    return {
      auth: mapAuthResponse({
        accessToken,
        user: session.user,
        company: session.user.company,
      }),
      refreshToken: nextRefreshToken,
      refreshExpiresAt: nextRefreshExpiresAt,
    };
  }

  static async logout(input: { refreshToken?: string; sessionId?: string }) {
    const now = new Date();

    if (input.refreshToken) {
      const session = await prisma.authSession.findUnique({
        where: { tokenHash: hashRefreshToken(input.refreshToken) },
        select: {
          id: true,
          userId: true,
          companyId: true,
          revokedAt: true,
        },
      });

      if (!session || session.revokedAt) {
        return;
      }

      await prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: now },
      });

      await AuditLogService.record({
        companyId: session.companyId,
        actorId: session.userId,
        action: "USER_LOGOUT",
        entityType: "AUTH_SESSION",
        entityId: session.id,
        metadata: {
          method: "refresh_cookie",
        },
      });
      return;
    }

    if (input.sessionId) {
      const session = await prisma.authSession.findUnique({
        where: { id: input.sessionId },
        select: {
          id: true,
          userId: true,
          companyId: true,
          revokedAt: true,
        },
      });

      if (!session || session.revokedAt) {
        return;
      }

      await prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: now },
      });

      await AuditLogService.record({
        companyId: session.companyId,
        actorId: session.userId,
        action: "USER_LOGOUT",
        entityType: "AUTH_SESSION",
        entityId: session.id,
        metadata: {
          method: "access_session",
        },
      });
    }
  }

  // ===== Return authenticated session user =====
  static async getCurrentUser(userId: string, companyId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, companyId, isActive: true, company: { isActive: true } },
      include: { company: true },
    });

    if (!user) {
      throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    }

    return {
      user: mapAuthResponse({ accessToken: "", user, company: user.company }).user,
      company: mapAuthResponse({ accessToken: "", user, company: user.company }).company,
    };
  }
}
