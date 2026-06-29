import {
  ConversationActivityAction,
  TicketActivityAction,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import { getIO } from "@/socket/socket.server.js";
import { mapConversation } from "@/modules/conversations/conversation.mapper.js";
import { mapTicket } from "@/modules/tickets/ticket.mapper.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { mapTeam, mapTeams } from "./team.mapper.js";
import type {
  AssignTeamInput,
  CreateTeamInput,
  UpdateTeamInput,
} from "./team.validation.js";

type UserContext = { userId: string; companyId: string; role: string };

const managementRoles = new Set(["OWNER", "ADMIN", "TEAM_LEAD"]);
const assertCanManageTeams = (user: UserContext) => {
  if (!managementRoles.has(user.role)) {
    throw new AppError("Team management is not allowed", HTTP_STATUS.FORBIDDEN);
  }
};
const assertCanAssign = (user: UserContext) => {
  if (user.role === "VIEWER") {
    throw new AppError("Team assignment is not allowed", HTTP_STATUS.FORBIDDEN);
  }
};

const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

const teamInclude = {
  members: {
    select: {
      teamId: true,
      userId: true,
      createdAt: true,
      user: { select: safeUserSelect },
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.TeamInclude;

export class TeamService {
  static async list(companyId: string) {
    const [
      teams,
      ticketCounts,
      openTicketCounts,
      conversationCounts,
      openConversationCounts,
    ] = await Promise.all([
      prisma.team.findMany({
        where: { companyId },
        include: teamInclude,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      prisma.ticket.groupBy({
        by: ["teamId"],
        where: { companyId, teamId: { not: null } },
        _count: { _all: true },
      }),
      prisma.ticket.groupBy({
        by: ["teamId"],
        where: {
          companyId,
          teamId: { not: null },
          status: { in: ["OPEN", "PENDING", "ESCALATED"] },
        },
        _count: { _all: true },
      }),
      prisma.conversation.groupBy({
        by: ["teamId"],
        where: { companyId, teamId: { not: null } },
        _count: { _all: true },
      }),
      prisma.conversation.groupBy({
        by: ["teamId"],
        where: {
          companyId,
          teamId: { not: null },
          status: { in: ["OPEN", "PENDING", "SNOOZED"] },
        },
        _count: { _all: true },
      }),
    ]);

    const toCountMap = (
      rows: Array<{ teamId: string | null; _count: { _all: number } }>,
    ) =>
      new Map(
        rows
          .filter((row): row is { teamId: string; _count: { _all: number } } =>
            Boolean(row.teamId),
          )
          .map((row) => [row.teamId, row._count._all]),
      );

    const ticketCountByTeam = toCountMap(ticketCounts);
    const openTicketCountByTeam = toCountMap(openTicketCounts);
    const conversationCountByTeam = toCountMap(conversationCounts);
    const openConversationCountByTeam = toCountMap(openConversationCounts);

    return mapTeams(
      teams.map((team) => ({
        ...team,
        ticketCount: ticketCountByTeam.get(team.id) ?? 0,
        openTicketCount: openTicketCountByTeam.get(team.id) ?? 0,
        conversationCount: conversationCountByTeam.get(team.id) ?? 0,
        openConversationCount: openConversationCountByTeam.get(team.id) ?? 0,
      })),
    );
  }

  static async create(user: UserContext, data: CreateTeamInput) {
    assertCanManageTeams(user);
    const team = await prisma.team.create({
      data: { companyId: user.companyId, ...data },
      include: teamInclude,
    });
    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "TEAM_CREATED",
      entityType: "TEAM",
      entityId: team.id,
      metadata: {
        name: team.name,
      },
    });
    return mapTeam(team);
  }

  static async update(user: UserContext, teamId: string, data: UpdateTeamInput) {
    assertCanManageTeams(user);
    await this.assertTeam(user.companyId, teamId);
    const team = await prisma.team.update({
      where: { id: teamId },
      data,
      include: teamInclude,
    });
    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "TEAM_UPDATED",
      entityType: "TEAM",
      entityId: team.id,
      metadata: {
        name: team.name,
      },
    });
    return mapTeam(team);
  }

  static async remove(user: UserContext, teamId: string) {
    assertCanManageTeams(user);
    const team = await this.assertTeam(user.companyId, teamId);
    await prisma.team.delete({ where: { id: teamId } });
    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "TEAM_DELETED",
      entityType: "TEAM",
      entityId: teamId,
      metadata: {
        name: team.name,
      },
    });
    return { id: teamId };
  }

  static async addMember(user: UserContext, teamId: string, memberId: string) {
    assertCanManageTeams(user);
    await this.assertTeam(user.companyId, teamId);
    const member = await prisma.user.findFirst({
      where: { id: memberId, companyId: user.companyId },
      select: { id: true },
    });
    if (!member) throw new AppError("User not found", HTTP_STATUS.NOT_FOUND);
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId: memberId } },
      update: {},
      create: { teamId, userId: memberId, companyId: user.companyId },
    });
    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "TEAM_MEMBER_ADDED",
      entityType: "TEAM",
      entityId: teamId,
      metadata: {
        memberId,
      },
    });
    return this.get(user.companyId, teamId);
  }

  static async removeMember(user: UserContext, teamId: string, memberId: string) {
    assertCanManageTeams(user);
    await this.assertTeam(user.companyId, teamId);
    await prisma.teamMember.deleteMany({
      where: { teamId, userId: memberId, companyId: user.companyId },
    });
    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "TEAM_MEMBER_REMOVED",
      entityType: "TEAM",
      entityId: teamId,
      metadata: {
        memberId,
      },
    });
    return this.get(user.companyId, teamId);
  }

  static async assignTicket(user: UserContext, ticketId: string, data: AssignTeamInput) {
    assertCanAssign(user);
    const existing = await prisma.ticket.findFirst({
      where: { id: ticketId, companyId: user.companyId },
      select: { id: true, teamId: true },
    });
    if (!existing) throw new AppError("Ticket not found", HTTP_STATUS.NOT_FOUND);
    if (data.teamId) await this.assertTeam(user.companyId, data.teamId);
    const changed = existing.teamId !== data.teamId;
    if (changed) {
      await prisma.$transaction([
        prisma.ticket.update({ where: { id: ticketId }, data: { teamId: data.teamId } }),
        prisma.ticketActivity.create({
          data: {
            companyId: user.companyId,
            ticketId,
            actorId: user.userId,
            action: data.teamId ? TicketActivityAction.TEAM_ASSIGNED : TicketActivityAction.TEAM_UNASSIGNED,
            metadata: { from: existing.teamId, to: data.teamId },
          },
        }),
      ]);
    }
    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, companyId: user.companyId },
      include: { assignee: { select: safeUserSelect }, createdBy: { select: safeUserSelect }, customer: true, conversation: true, team: true, tags: { include: { tag: true } } },
    });
    const dto = mapTicket(ticket!);
    if (changed) {
      getIO().to(`company:${user.companyId}`).emit("ticket_updated", dto);
      await AuditLogService.record({
        companyId: user.companyId,
        actorId: user.userId,
        action: data.teamId ? "TICKET_TEAM_ASSIGNED" : "TICKET_TEAM_UNASSIGNED",
        entityType: "TICKET",
        entityId: ticketId,
        metadata: { from: existing.teamId, to: data.teamId },
      });
    }
    return dto;
  }

  static async assignConversation(user: UserContext, conversationId: string, data: AssignTeamInput) {
    assertCanAssign(user);
    const existing = await prisma.conversation.findFirst({
      where: { id: conversationId, companyId: user.companyId },
      select: { id: true, teamId: true },
    });
    if (!existing) throw new AppError("Conversation not found", HTTP_STATUS.NOT_FOUND);
    if (data.teamId) await this.assertTeam(user.companyId, data.teamId);
    const changed = existing.teamId !== data.teamId;
    if (changed) {
      await prisma.$transaction([
        prisma.conversation.update({ where: { id: conversationId }, data: { teamId: data.teamId } }),
        prisma.conversationActivity.create({
          data: {
            companyId: user.companyId,
            conversationId,
            actorId: user.userId,
            action: data.teamId ? ConversationActivityAction.TEAM_ASSIGNED : ConversationActivityAction.TEAM_UNASSIGNED,
            metadata: { from: existing.teamId, to: data.teamId },
          },
        }),
      ]);
    }
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, companyId: user.companyId },
      include: { customer: true, team: true, messages: { orderBy: { createdAt: "asc" } }, tags: { include: { tag: true } }, activities: { include: { actor: { select: safeUserSelect } }, orderBy: { createdAt: "desc" } } },
    });
    const dto = mapConversation(conversation!);
    if (changed) {
      getIO().to(`company:${user.companyId}`).emit("conversation:updated", dto);
      await AuditLogService.record({
        companyId: user.companyId,
        actorId: user.userId,
        action: data.teamId
          ? "CONVERSATION_TEAM_ASSIGNED"
          : "CONVERSATION_TEAM_UNASSIGNED",
        entityType: "CONVERSATION",
        entityId: conversationId,
        metadata: { from: existing.teamId, to: data.teamId },
      });
    }
    return dto;
  }

  private static async get(companyId: string, teamId: string) {
    const team = await prisma.team.findFirst({ where: { id: teamId, companyId }, include: teamInclude });
    if (!team) throw new AppError("Team not found", HTTP_STATUS.NOT_FOUND);
    return mapTeam(team);
  }

  private static async assertTeam(companyId: string, teamId: string) {
    const team = await prisma.team.findFirst({ where: { id: teamId, companyId }, select: { id: true, name: true } });
    if (!team) throw new AppError("Team not found", HTTP_STATUS.NOT_FOUND);
    return team;
  }
}
