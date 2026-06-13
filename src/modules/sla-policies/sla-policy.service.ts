import { prisma } from "@/config/db.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { mapSlaPolicies, mapSlaPolicy } from "./sla-policy.mapper.js";
import type {
  CreateSlaPolicyInput,
  UpdateSlaPolicyInput,
} from "./sla-policy.validation.js";

type UserContext = {
  userId: string;
  companyId: string;
  role: string;
};

const allowedRoles = new Set(["OWNER", "ADMIN", "TEAM_LEAD"]);

const assertCanManage = (user: UserContext) => {
  if (!allowedRoles.has(user.role)) {
    throw new AppError(
      "SLA policy changes require owner, admin, or team lead access",
      HTTP_STATUS.FORBIDDEN
    );
  }
};

export class SlaPolicyService {
  static async list(companyId: string) {
    const policies = await prisma.slaPolicy.findMany({
      where: { companyId },
      orderBy: [{ priority: "asc" }, { name: "asc" }],
    });
    return mapSlaPolicies(policies);
  }

  static async create(user: UserContext, data: CreateSlaPolicyInput) {
    assertCanManage(user);

    const policy = await prisma.$transaction(async (tx) => {
      if (data.enabled) {
        await tx.slaPolicy.updateMany({
          where: { companyId: user.companyId, priority: data.priority },
          data: { enabled: false },
        });
      }

      return tx.slaPolicy.create({
        data: { ...data, companyId: user.companyId },
      });
    });

    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "SLA_POLICY_CREATED",
      entityType: "SLA_POLICY",
      entityId: policy.id,
      metadata: { priority: policy.priority, enabled: policy.enabled },
    });

    return mapSlaPolicy(policy);
  }

  static async update(
    user: UserContext,
    policyId: string,
    data: UpdateSlaPolicyInput
  ) {
    assertCanManage(user);
    const existing = await prisma.slaPolicy.findFirst({
      where: { id: policyId, companyId: user.companyId },
    });
    if (!existing) {
      throw new AppError("SLA policy not found", HTTP_STATUS.NOT_FOUND);
    }

    const priority = data.priority ?? existing.priority;
    const enabled = data.enabled ?? existing.enabled;
    const policy = await prisma.$transaction(async (tx) => {
      if (enabled) {
        await tx.slaPolicy.updateMany({
          where: {
            companyId: user.companyId,
            priority,
            id: { not: existing.id },
          },
          data: { enabled: false },
        });
      }

      return tx.slaPolicy.update({
        where: { id: existing.id },
        data,
      });
    });

    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "SLA_POLICY_UPDATED",
      entityType: "SLA_POLICY",
      entityId: policy.id,
      metadata: { priority: policy.priority, enabled: policy.enabled },
    });

    return mapSlaPolicy(policy);
  }

  static async delete(user: UserContext, policyId: string) {
    assertCanManage(user);
    const existing = await prisma.slaPolicy.findFirst({
      where: { id: policyId, companyId: user.companyId },
    });
    if (!existing) {
      throw new AppError("SLA policy not found", HTTP_STATUS.NOT_FOUND);
    }

    await prisma.slaPolicy.delete({ where: { id: existing.id } });
    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "SLA_POLICY_DELETED",
      entityType: "SLA_POLICY",
      entityId: existing.id,
      metadata: { priority: existing.priority },
    });
    return mapSlaPolicy(existing);
  }
}
