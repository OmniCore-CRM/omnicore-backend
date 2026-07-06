import {
  AssignmentRuleConditionType,
  AssignmentRuleTargetType,
  ConversationActivityAction,
  ConversationChannel,
  Prisma,
  TicketActivityAction,
  TicketPriority,
  UserRole,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import {
  Permissions,
  hasPermission,
} from "@/core/permissions/permission-policy.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { mapConversation } from "@/modules/conversations/conversation.mapper.js";
import { mapTicket } from "@/modules/tickets/ticket.mapper.js";
import { getIO } from "@/socket/socket.server.js";
import { mapAssignmentRule, mapAssignmentRules } from "./assignment-rule.mapper.js";
import type {
  CreateAssignmentRuleInput,
  UpdateAssignmentRuleInput,
} from "./assignment-rule.validation.js";

const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

type UserContext = { userId: string; companyId: string; role: string };
type AutomaticAssignmentInput = {
  companyId: string;
  actorId?: string | null;
};

const assertCanManage = (user: UserContext) => {
  if (!hasPermission(user.role as UserRole, Permissions.manageAssignmentRules)) {
    throw new AppError(
      "Assignment rule changes require owner or admin access",
      HTTP_STATUS.FORBIDDEN
    );
  }
};

const normalizeConditionValue = (
  conditionType: AssignmentRuleConditionType,
  value: string
) =>
  conditionType === AssignmentRuleConditionType.TAG
    ? value.trim()
    : value.trim().toUpperCase();

const ruleInclude = { team: true } satisfies Prisma.AssignmentRuleInclude;

export class AssignmentRuleService {
  static async list(companyId: string) {
    const rules = await prisma.assignmentRule.findMany({
      where: { companyId },
      include: ruleInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return mapAssignmentRules(rules);
  }

  static async create(user: UserContext, data: CreateAssignmentRuleInput) {
    assertCanManage(user);
    await this.assertReferences(user.companyId, data);

    try {
      const rule = await prisma.assignmentRule.create({
        data: {
          ...data,
          companyId: user.companyId,
          conditionValue: normalizeConditionValue(
            data.conditionType,
            data.conditionValue
          ),
        },
        include: ruleInclude,
      });
      await this.recordRuleAudit(user, "ASSIGNMENT_RULE_CREATED", rule.id, rule);
      return mapAssignmentRule(rule);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(
          "An assignment rule with this name already exists",
          HTTP_STATUS.CONFLICT
        );
      }
      throw error;
    }
  }

  static async update(
    user: UserContext,
    ruleId: string,
    data: UpdateAssignmentRuleInput
  ) {
    assertCanManage(user);
    const existing = await this.assertRule(user.companyId, ruleId);
    const merged = {
      targetType: data.targetType ?? existing.targetType,
      conditionType: data.conditionType ?? existing.conditionType,
      conditionValue: data.conditionValue ?? existing.conditionValue,
      teamId: data.teamId ?? existing.teamId,
    };
    await this.assertReferences(user.companyId, merged);

    let rule;
    try {
      rule = await prisma.assignmentRule.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(data.conditionValue !== undefined || data.conditionType !== undefined
            ? {
                conditionValue: normalizeConditionValue(
                  merged.conditionType,
                  merged.conditionValue
                ),
              }
            : {}),
        },
        include: ruleInclude,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(
          "An assignment rule with this name already exists",
          HTTP_STATUS.CONFLICT
        );
      }
      throw error;
    }
    await this.recordRuleAudit(user, "ASSIGNMENT_RULE_UPDATED", rule.id, rule);
    return mapAssignmentRule(rule);
  }

  static async delete(user: UserContext, ruleId: string) {
    assertCanManage(user);
    const existing = await this.assertRule(user.companyId, ruleId);
    await prisma.assignmentRule.delete({ where: { id: existing.id } });
    await this.recordRuleAudit(
      user,
      "ASSIGNMENT_RULE_DELETED",
      existing.id,
      existing
    );
    return mapAssignmentRule(existing);
  }

  static async applyConversationRules(
    input: AutomaticAssignmentInput & {
      conversationId: string;
      channel: ConversationChannel;
    }
  ) {
    const rule = await prisma.assignmentRule.findFirst({
      where: {
        companyId: input.companyId,
        enabled: true,
        targetType: AssignmentRuleTargetType.CONVERSATION,
        conditionType: AssignmentRuleConditionType.CHANNEL,
        conditionValue: input.channel,
      },
      include: ruleInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!rule) return null;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.conversation.updateMany({
        where: {
          id: input.conversationId,
          companyId: input.companyId,
          teamId: null,
        },
        data: { teamId: rule.teamId },
      });
      if (result.count === 0) return false;

      await tx.conversationActivity.create({
        data: {
          companyId: input.companyId,
          conversationId: input.conversationId,
          actorId: input.actorId ?? null,
          action: ConversationActivityAction.AUTO_TEAM_ASSIGNED,
          metadata: { ruleId: rule.id, teamId: rule.teamId },
        },
      });
      return true;
    });
    if (!updated) return null;

    await this.recordAutomaticAudit(
      input,
      "CONVERSATION_AUTO_TEAM_ASSIGNED",
      "CONVERSATION",
      input.conversationId,
      rule.id,
      rule.teamId
    );
    await this.emitConversationUpdated(input.companyId, input.conversationId);
    return mapAssignmentRule(rule);
  }

  static async applyTicketRules(
    input: AutomaticAssignmentInput & {
      ticketId: string;
      priority: TicketPriority;
    }
  ) {
    const tagIds = (
      await prisma.ticketTag.findMany({
        where: { companyId: input.companyId, ticketId: input.ticketId },
        select: { tagId: true },
      })
    ).map((link) => link.tagId);

    const rule = await prisma.assignmentRule.findFirst({
      where: {
        companyId: input.companyId,
        enabled: true,
        targetType: AssignmentRuleTargetType.TICKET,
        OR: [
          {
            conditionType: AssignmentRuleConditionType.PRIORITY,
            conditionValue: input.priority,
          },
          ...(tagIds.length > 0
            ? [
                {
                  conditionType: AssignmentRuleConditionType.TAG,
                  conditionValue: { in: tagIds },
                },
              ]
            : []),
        ],
      },
      include: ruleInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!rule) return null;

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.ticket.updateMany({
        where: {
          id: input.ticketId,
          companyId: input.companyId,
          teamId: null,
        },
        data: { teamId: rule.teamId },
      });
      if (result.count === 0) return false;

      await tx.ticketActivity.create({
        data: {
          companyId: input.companyId,
          ticketId: input.ticketId,
          actorId: input.actorId ?? null,
          action: TicketActivityAction.AUTO_TEAM_ASSIGNED,
          metadata: { ruleId: rule.id, teamId: rule.teamId },
        },
      });
      return true;
    });
    if (!updated) return null;

    await this.recordAutomaticAudit(
      input,
      "TICKET_AUTO_TEAM_ASSIGNED",
      "TICKET",
      input.ticketId,
      rule.id,
      rule.teamId
    );
    await this.emitTicketUpdated(input.companyId, input.ticketId);
    return mapAssignmentRule(rule);
  }

  private static async assertReferences(
    companyId: string,
    data: {
      targetType: AssignmentRuleTargetType;
      conditionType: AssignmentRuleConditionType;
      conditionValue: string;
      teamId: string;
    }
  ) {
    const team = await prisma.team.findFirst({
      where: { id: data.teamId, companyId },
      select: { id: true },
    });
    if (!team) throw new AppError("Team not found", HTTP_STATUS.NOT_FOUND);

    if (
      data.targetType === AssignmentRuleTargetType.CONVERSATION &&
      data.conditionType !== AssignmentRuleConditionType.CHANNEL
    ) {
      throw new AppError(
        "Conversation rules only support channel conditions",
        HTTP_STATUS.BAD_REQUEST
      );
    }
    if (
      data.targetType === AssignmentRuleTargetType.TICKET &&
      data.conditionType !== AssignmentRuleConditionType.PRIORITY &&
      data.conditionType !== AssignmentRuleConditionType.TAG
    ) {
      throw new AppError(
        "Ticket rules only support priority or tag conditions",
        HTTP_STATUS.BAD_REQUEST
      );
    }
    if (data.conditionType === AssignmentRuleConditionType.TAG) {
      const tag = await prisma.tag.findFirst({
        where: { id: data.conditionValue, companyId },
        select: { id: true },
      });
      if (!tag) throw new AppError("Tag not found", HTTP_STATUS.NOT_FOUND);
    }
    if (
      data.conditionType === AssignmentRuleConditionType.CHANNEL &&
      data.conditionValue !== ConversationChannel.WHATSAPP &&
      data.conditionValue !== ConversationChannel.WEBSITE
    ) {
      throw new AppError(
        "Channel must be WEBSITE or WHATSAPP",
        HTTP_STATUS.BAD_REQUEST
      );
    }
    if (
      data.conditionType === AssignmentRuleConditionType.PRIORITY &&
      !Object.values(TicketPriority).includes(
        data.conditionValue as TicketPriority
      )
    ) {
      throw new AppError("Priority is invalid", HTTP_STATUS.BAD_REQUEST);
    }
  }

  private static async assertRule(companyId: string, ruleId: string) {
    const rule = await prisma.assignmentRule.findFirst({
      where: { id: ruleId, companyId },
      include: ruleInclude,
    });
    if (!rule) {
      throw new AppError("Assignment rule not found", HTTP_STATUS.NOT_FOUND);
    }
    return rule;
  }

  private static async recordRuleAudit(
    user: UserContext,
    action: string,
    entityId: string,
    rule: {
      targetType: AssignmentRuleTargetType;
      conditionType: AssignmentRuleConditionType;
      conditionValue: string;
      teamId: string;
      enabled: boolean;
    }
  ) {
    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action,
      entityType: "ASSIGNMENT_RULE",
      entityId,
      metadata: {
        targetType: rule.targetType,
        conditionType: rule.conditionType,
        conditionValue: rule.conditionValue,
        teamId: rule.teamId,
        enabled: rule.enabled,
      },
    });
  }

  private static async recordAutomaticAudit(
    input: AutomaticAssignmentInput,
    action: string,
    entityType: string,
    entityId: string,
    ruleId: string,
    teamId: string
  ) {
    await AuditLogService.record({
      companyId: input.companyId,
      actorId: input.actorId ?? null,
      action,
      entityType,
      entityId,
      metadata: { ruleId, teamId },
    });
  }

  private static async emitConversationUpdated(
    companyId: string,
    conversationId: string
  ) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, companyId },
      include: {
        customer: true,
        team: true,
        messages: { orderBy: { createdAt: "asc" } },
        tags: { include: { tag: true } },
      },
    });
    if (conversation) {
      getIO()
        .to(`company:${companyId}`)
        .emit("conversation:updated", mapConversation(conversation));
    }
  }

  private static async emitTicketUpdated(companyId: string, ticketId: string) {
    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, companyId },
      include: {
        assignee: { select: safeUserSelect },
        createdBy: { select: safeUserSelect },
        customer: true,
        conversation: true,
        team: true,
        tags: { include: { tag: true } },
      },
    });
    if (ticket) {
      getIO().to(`company:${companyId}`).emit("ticket_updated", mapTicket(ticket));
    }
  }
}
