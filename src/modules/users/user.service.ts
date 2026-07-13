import bcrypt from "bcrypt";
import {
  Prisma,
  UserLifecycleStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import {
  Permissions,
  hasPermission,
} from "@/core/permissions/permission-policy.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { AuthService } from "@/modules/auth/auth.service.js";
import { NotificationService } from "@/modules/notifications/notification.service.js";
import { mapUsers } from "./user.mapper.js";
import { NotificationType } from "@prisma/client";
import { disconnectUserSockets } from "@/socket/socket.server.js";
import type {
  CreateUserInput,
  UpdateUserInput,
  UpdateUserStatusInput,
  UserListQueryInput,
} from "./user.validation.js";

const userListCacheTtlMs = 30_000;

type UserListCacheEntry = {
  expiresAt: number;
  users: Array<Record<string, unknown>>;
};

export class UserService {
  private static readonly listCache = new Map<string, UserListCacheEntry>();
  private static readonly editableRoles = new Set<UserRole>([
    UserRole.OWNER,
    UserRole.ADMIN,
    UserRole.TEAM_LEAD,
    UserRole.AGENT,
    UserRole.VIEWER,
  ]);

  private static clearListCache(companyId: string) {
    this.listCache.delete(companyId);
  }

  private static serializeUserWithInvite(
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: UserRole;
      status: UserLifecycleStatus;
      companyId: string;
      createdAt: Date;
      updatedAt: Date;
      receivedInviteTokens?: Array<{
        id: string;
        createdAt: Date;
        expiresAt: Date;
        revokedAt: Date | null;
        consumedAt: Date | null;
      }>;
    },
  ) {
    const mapped = mapUsers([user])[0] as Record<string, unknown>;
    const latestInvite = user.receivedInviteTokens?.[0] ?? null;

    if (user.status !== UserLifecycleStatus.INVITED || !latestInvite) {
      return {
        ...mapped,
        invitationState: "NONE",
        invitationSentAt: null,
        invitationExpiresAt: null,
      };
    }

    const now = Date.now();
    const invitationState = latestInvite.consumedAt
      ? "ACCEPTED"
      : latestInvite.revokedAt
        ? "REVOKED"
        : latestInvite.expiresAt.getTime() <= now
          ? "EXPIRED"
          : "PENDING";

    return {
      ...mapped,
      invitationState,
      invitationSentAt: latestInvite.createdAt,
      invitationExpiresAt: latestInvite.expiresAt,
    };
  }

  private static async getUserForManagement(companyId: string, userId: string) {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        companyId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        companyId: true,
        createdAt: true,
        updatedAt: true,
        receivedInviteTokens: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          select: {
            id: true,
            createdAt: true,
            expiresAt: true,
            revokedAt: true,
            consumedAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    }

    return user;
  }

  private static assertCanManageUsers(actorRole: UserRole) {
    if (!hasPermission(actorRole, Permissions.manageUsers)) {
      throw new AppError(
        "User management is not allowed",
        HTTP_STATUS.FORBIDDEN,
      );
    }
  }

  private static assertManageableRole(
    actorRole: UserRole,
    targetRole: UserRole,
  ) {
    if (!this.editableRoles.has(targetRole)) {
      throw new AppError("Role is not supported", HTTP_STATUS.BAD_REQUEST);
    }

    if (actorRole === UserRole.ADMIN && targetRole === UserRole.OWNER) {
      throw new AppError(
        "Admin cannot assign owner role",
        HTTP_STATUS.FORBIDDEN,
      );
    }
  }

  private static assertManageableTarget(
    actorRole: UserRole,
    targetRole: UserRole,
  ) {
    if (actorRole === UserRole.ADMIN && targetRole === UserRole.OWNER) {
      throw new AppError(
        "Admin cannot modify owner users",
        HTTP_STATUS.FORBIDDEN,
      );
    }
  }

  static async getCompanyUsers(companyId: string, query: UserListQueryInput) {
    const hasFilter = Boolean(query.search || query.role || query.status);
    const cacheKey = companyId;
    const cached = this.listCache.get(cacheKey);

    if (!hasFilter && cached && cached.expiresAt > Date.now()) {
      return cached.users;
    }

    if (!hasFilter && cached && cached.expiresAt <= Date.now()) {
      this.listCache.delete(cacheKey);
    }

    const search = query.search?.trim();

    const where: Prisma.UserWhereInput = {
      companyId,
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              {
                firstName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                lastName: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                email: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    };

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        companyId: true,
        createdAt: true,
        updatedAt: true,
        receivedInviteTokens: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          select: {
            id: true,
            createdAt: true,
            expiresAt: true,
            revokedAt: true,
            consumedAt: true,
          },
        },
      },
      orderBy: [
        {
          firstName: "asc",
        },
        {
          lastName: "asc",
        },
      ],
    });

    const mapped = users.map((item) => this.serializeUserWithInvite(item));

    if (!hasFilter) {
      this.listCache.set(cacheKey, {
        expiresAt: Date.now() + userListCacheTtlMs,
        users: mapped,
      });
    }

    return mapped;
  }

  static async createCompanyUser(input: {
    actorId: string;
    actorRole: UserRole;
    companyId: string;
    data: CreateUserInput;
  }) {
    this.assertCanManageUsers(input.actorRole);
    this.assertManageableRole(input.actorRole, input.data.role);

    const passwordHash = await bcrypt.hash(input.data.password, 10);
    const isActive = input.data.status === UserLifecycleStatus.ACTIVE;

    try {
      const created = await prisma.user.create({
        data: {
          companyId: input.companyId,
          firstName: input.data.firstName,
          lastName: input.data.lastName,
          email: input.data.email,
          passwordHash,
          role: input.data.role,
          status: input.data.status,
          isActive,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          companyId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      this.clearListCache(input.companyId);

      await AuditLogService.record({
        companyId: input.companyId,
        actorId: input.actorId,
        action: "USER_CREATED",
        entityType: "USER",
        entityId: created.id,
        metadata: {
          role: created.role,
          status: created.status,
        },
      });

      return this.serializeUserWithInvite(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError("Email is already in use", HTTP_STATUS.CONFLICT);
      }

      throw error;
    }
  }

  static async updateCompanyUser(input: {
    actorId: string;
    actorUserId: string;
    actorRole: UserRole;
    companyId: string;
    userId: string;
    data: UpdateUserInput;
  }) {
    this.assertCanManageUsers(input.actorRole);

    if (input.actorUserId === input.userId) {
      throw new AppError(
        "You cannot edit your own user profile here",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const existing = await prisma.user.findFirst({
      where: {
        id: input.userId,
        companyId: input.companyId,
      },
      select: {
        id: true,
        role: true,
        email: true,
      },
    });

    if (!existing) {
      throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    }

    this.assertManageableTarget(input.actorRole, existing.role);

    if (input.data.role) {
      this.assertManageableRole(input.actorRole, input.data.role);
    }

    const nextRole = input.data.role ?? existing.role;

    try {
      const updated = await prisma.user.update({
        where: {
          id: existing.id,
        },
        data: {
          ...(input.data.firstName !== undefined
            ? { firstName: input.data.firstName }
            : {}),
          ...(input.data.lastName !== undefined
            ? { lastName: input.data.lastName }
            : {}),
          ...(input.data.email !== undefined
            ? { email: input.data.email }
            : {}),
          ...(input.data.role !== undefined
            ? { role: nextRole }
            : {}),
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          companyId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      this.clearListCache(input.companyId);

      await AuditLogService.record({
        companyId: input.companyId,
        actorId: input.actorId,
        action: "USER_UPDATED",
        entityType: "USER",
        entityId: updated.id,
        metadata: {
          fields: [
            input.data.firstName !== undefined ? "firstName" : null,
            input.data.lastName !== undefined ? "lastName" : null,
            input.data.email !== undefined ? "email" : null,
            input.data.role !== undefined ? "role" : null,
          ].filter(Boolean),
        },
      });

      if (existing.role !== updated.role) {
        await AuditLogService.record({
          companyId: input.companyId,
          actorId: input.actorId,
          action: "USER_ROLE_CHANGED",
          entityType: "USER",
          entityId: updated.id,
          metadata: {
            from: existing.role,
            to: updated.role,
          },
        });

        await NotificationService.notifySystemEvent({
          companyId: input.companyId,
          userId: updated.id,
          type: NotificationType.ROLE_CHANGED,
          title: "Role updated",
          message: `Your role was changed from ${existing.role} to ${updated.role}.`,
          entityType: "USER",
          entityId: updated.id,
          metadata: {
            from: existing.role,
            to: updated.role,
            route: "/settings",
          },
        });
      }

      return this.serializeUserWithInvite(updated);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError("Email is already in use", HTTP_STATUS.CONFLICT);
      }

      throw error;
    }
  }

  static async updateCompanyUserStatus(input: {
    actorId: string;
    actorUserId: string;
    actorRole: UserRole;
    companyId: string;
    userId: string;
    data: UpdateUserStatusInput;
  }) {
    this.assertCanManageUsers(input.actorRole);

    if (input.actorUserId === input.userId) {
      throw new AppError(
        "You cannot change your own status",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const existing = await prisma.user.findFirst({
      where: {
        id: input.userId,
        companyId: input.companyId,
      },
      select: {
        id: true,
        role: true,
        status: true,
      },
    });

    if (!existing) {
      throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    }

    this.assertManageableTarget(input.actorRole, existing.role);

    const nextStatus = input.data.status;
    const isActive = nextStatus === UserLifecycleStatus.ACTIVE;

    const updated = await prisma.user.update({
      where: {
        id: existing.id,
      },
      data: {
        status: nextStatus,
        isActive,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        companyId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.clearListCache(input.companyId);

    if (existing.status !== updated.status) {
      if (updated.status !== UserLifecycleStatus.ACTIVE) {
        disconnectUserSockets(updated.id);
      }

      const actionByStatus: Record<UserLifecycleStatus, string> = {
        INVITED: "USER_UPDATED",
        ACTIVE: "USER_ACTIVATED",
        SUSPENDED: "USER_SUSPENDED",
        DEACTIVATED: "USER_DEACTIVATED",
      };

      await AuditLogService.record({
        companyId: input.companyId,
        actorId: input.actorId,
        action: actionByStatus[updated.status],
        entityType: "USER",
        entityId: updated.id,
        metadata: {
          from: existing.status,
          to: updated.status,
        },
      });

      if (updated.status === UserLifecycleStatus.ACTIVE) {
        await NotificationService.notifySystemEvent({
          companyId: input.companyId,
          userId: updated.id,
          type: NotificationType.USER_ACTIVATED,
          title: "Account activated",
          message: "Your account is now active.",
          entityType: "USER",
          entityId: updated.id,
          metadata: {
            route: "/settings",
          },
        });
      }
    }

    return this.serializeUserWithInvite(updated);
  }

  static async sendCompanyUserInvite(input: {
    actorId: string;
    actorUserId: string;
    actorRole: UserRole;
    companyId: string;
    userId: string;
    mode: "invite" | "resend";
  }) {
    this.assertCanManageUsers(input.actorRole);

    if (input.actorUserId === input.userId) {
      throw new AppError(
        "You cannot send an invite to your own account",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const existing = await this.getUserForManagement(input.companyId, input.userId);
    this.assertManageableTarget(input.actorRole, existing.role);

    if (existing.status !== UserLifecycleStatus.INVITED) {
      throw new AppError(
        "Only invited users can receive onboarding links",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const actor = await prisma.user.findFirst({
      where: {
        id: input.actorId,
        companyId: input.companyId,
      },
      select: {
        firstName: true,
        lastName: true,
      },
    });

    const inviterName = actor
      ? [actor.firstName, actor.lastName].filter(Boolean).join(" ")
      : "Your OmniCore admin";

    const payload = AuthService.createInviteTokenPayload();
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.userInviteToken.updateMany({
        where: {
          companyId: input.companyId,
          userId: input.userId,
          consumedAt: null,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      await tx.userInviteToken.create({
        data: {
          companyId: input.companyId,
          userId: input.userId,
          invitedById: input.actorId,
          tokenHash: payload.tokenHash,
          expiresAt: payload.expiresAt,
        },
      });
    });

    const emailDelivered = await AuthService.sendUserInviteEmail({
      toEmail: existing.email,
      firstName: existing.firstName,
      inviterName,
      inviteUrl: payload.inviteUrl,
      expiresAt: payload.expiresAt,
    });

    await AuditLogService.record({
      companyId: input.companyId,
      actorId: input.actorId,
      action: input.mode === "resend" ? "USER_INVITE_RESENT" : "USER_INVITE_SENT",
      entityType: "USER",
      entityId: input.userId,
      metadata: {
        expiresAt: payload.expiresAt.toISOString(),
        emailDelivery: emailDelivered ? "sent" : "failed_or_not_configured",
      },
    });

    this.clearListCache(input.companyId);
    const refreshed = await this.getUserForManagement(input.companyId, input.userId);
    return this.serializeUserWithInvite(refreshed);
  }

  static async revokeCompanyUserInvite(input: {
    actorId: string;
    actorUserId: string;
    actorRole: UserRole;
    companyId: string;
    userId: string;
  }) {
    this.assertCanManageUsers(input.actorRole);

    if (input.actorUserId === input.userId) {
      throw new AppError(
        "You cannot revoke your own invite",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const existing = await this.getUserForManagement(input.companyId, input.userId);
    this.assertManageableTarget(input.actorRole, existing.role);

    if (existing.status !== UserLifecycleStatus.INVITED) {
      throw new AppError(
        "Only invited users can have invites revoked",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    const now = new Date();
    const result = await prisma.userInviteToken.updateMany({
      where: {
        companyId: input.companyId,
        userId: input.userId,
        consumedAt: null,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });

    await AuditLogService.record({
      companyId: input.companyId,
      actorId: input.actorId,
      action: "USER_INVITE_REVOKED",
      entityType: "USER",
      entityId: input.userId,
      metadata: {
        revokedTokenCount: result.count,
      },
    });

    this.clearListCache(input.companyId);
    const refreshed = await this.getUserForManagement(input.companyId, input.userId);
    return this.serializeUserWithInvite(refreshed);
  }
}
