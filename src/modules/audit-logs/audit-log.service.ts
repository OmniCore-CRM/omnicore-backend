import type { Prisma } from "@prisma/client";
import { prisma } from "@/config/db.js";
import { toPaginatedResult } from "@/core/utils/pagination.js";
import { mapAuditLogs } from "./audit-log.mapper.js";
import type { AuditLogListQueryInput } from "./audit-log.validation.js";

type AuditLogInput = {
  companyId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue | null;
};

export class AuditLogService {
  static async record(input: AuditLogInput) {
    await prisma.auditLog.create({
      data: {
        companyId: input.companyId,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata ?? undefined,
      },
    });
  }

  static async list(companyId: string, query: AuditLogListQueryInput) {
    const where: Prisma.AuditLogWhereInput = {
      companyId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
    };

    const logs = await prisma.auditLog.findMany({
      where,
      include: {
        actor: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
    });

    const page = toPaginatedResult(logs, query.limit);
    return {
      ...page,
      items: mapAuditLogs(page.items),
    };
  }
}
