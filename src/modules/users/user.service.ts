import bcrypt from "bcrypt";
import {
  Prisma,
  UserLifecycleStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { mapUsers } from "./user.mapper.js";
import type {
  CreateUserInput,
  UpdateUserInput,
  UpdateUserStatusInput,
  UserListQueryInput,
} from "./user.validation.js";

const userListCacheTtlMs = 30_000;

type UserListCacheEntry = {
  expiresAt: number;
  users: ReturnType<typeof mapUsers>;
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

  private static assertCanManageUsers(actorRole: UserRole) {
    if (actorRole !== UserRole.OWNER && actorRole !== UserRole.ADMIN) {
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

    const mapped = mapUsers(users);

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

      return mapUsers([created])[0];
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
      }

      return mapUsers([updated])[0];
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
    }

    return mapUsers([updated])[0];
  }
}
