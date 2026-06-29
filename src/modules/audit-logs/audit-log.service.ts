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

const SENSITIVE_METADATA_KEY_PATTERN =
  /(password|passcode|token|secret|authorization|cookie|header|raw(body|payload)?|payload|signature|api[_-]?key|refresh|access[_-]?key|session)/i;

const MAX_METADATA_DEPTH = 6;

const sanitizeAuditMetadataValue = (
  value: unknown,
  keyPath: string[] = [],
  depth = 0
): Prisma.InputJsonValue => {
  if (depth > MAX_METADATA_DEPTH) {
    return "[TRUNCATED]";
  }

  const currentKey = keyPath[keyPath.length - 1] ?? "";
  if (SENSITIVE_METADATA_KEY_PATTERN.test(currentKey)) {
    return "[REDACTED]";
  }

  if (value === null) return "[NULL]";

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeAuditMetadataValue(item, keyPath, depth + 1)
    );
  }

  if (typeof value === "object") {
    const sanitizedObject: Record<string, Prisma.InputJsonValue> = {};

    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_METADATA_KEY_PATTERN.test(key)) {
        sanitizedObject[key] = "[REDACTED]";
        continue;
      }

      sanitizedObject[key] = sanitizeAuditMetadataValue(
        nested,
        [...keyPath, key],
        depth + 1
      );
    }

    return sanitizedObject as Prisma.InputJsonObject;
  }

  return String(value);
};

const sanitizeAuditMetadata = (
  metadata: Prisma.InputJsonValue | null | undefined
): Prisma.InputJsonValue | undefined => {
  if (metadata === null || metadata === undefined) {
    return undefined;
  }

  return sanitizeAuditMetadataValue(metadata);
};

export class AuditLogService {
  /**
   * Phase 7 baseline notes:
   * - Retention: keep audit rows append-only and enforce a scheduled DB retention job
   *   (for example: prune rows older than policy window per tenant/compliance contract).
   * - Tamper-evidence: use an append-only hash-chain digest (prev_hash + canonical_row)
   *   and periodically anchor digests externally. This service currently prepares safe,
   *   redacted metadata and avoids storing secret-bearing payloads.
   */
  static async record(input: AuditLogInput) {
    await prisma.auditLog.create({
      data: {
        companyId: input.companyId,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: sanitizeAuditMetadata(input.metadata),
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
