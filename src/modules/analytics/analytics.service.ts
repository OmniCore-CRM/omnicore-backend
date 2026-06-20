import type { Prisma } from "@prisma/client";
import { prisma } from "@/config/db.js";
import { mapAnalyticsOverview } from "./analytics.mapper.js";
import type {
  AnalyticsOverviewQueryInput,
  AnalyticsRange,
} from "./analytics.validation.js";

const rangeDays: Record<Exclude<AnalyticsRange, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const getRangeStart = (range: AnalyticsRange) => {
  if (range === "all") return null;
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - rangeDays[range]);
  return from;
};

const createdAtWhere = (from: Date | null) =>
  from ? { createdAt: { gte: from } } : {};

export class AnalyticsService {
  static async overview(
    companyId: string,
    query: AnalyticsOverviewQueryInput
  ) {
    const from = getRangeStart(query.range);
    const customerWhere: Prisma.CustomerWhereInput = {
      companyId,
      ...createdAtWhere(from),
    };
    const conversationWhere: Prisma.ConversationWhereInput = {
      companyId,
      ...createdAtWhere(from),
    };
    const ticketWhere: Prisma.TicketWhereInput = {
      companyId,
      ...createdAtWhere(from),
    };
    const attachmentWhere: Prisma.AttachmentWhereInput = {
      companyId,
      ...createdAtWhere(from),
    };
    const auditWhere: Prisma.AuditLogWhereInput = {
      companyId,
      ...createdAtWhere(from),
    };

    const [
      customerCount,
      conversationStatuses,
      ticketStatuses,
      attachmentCount,
      teamCount,
      conversationChannels,
      ticketPriorities,
      ticketsByTeam,
      conversationsByTeam,
      teams,
      recentActivity,
    ] = await Promise.all([
      prisma.customer.count({ where: customerWhere }),
      prisma.conversation.groupBy({
        by: ["status"],
        where: conversationWhere,
        _count: { _all: true },
      }),
      prisma.ticket.groupBy({
        by: ["status"],
        where: ticketWhere,
        _count: { _all: true },
      }),
      prisma.attachment.count({ where: attachmentWhere }),
      prisma.team.count({ where: { companyId } }),
      prisma.conversation.groupBy({
        by: ["channel"],
        where: conversationWhere,
        _count: { _all: true },
      }),
      prisma.ticket.groupBy({
        by: ["priority"],
        where: ticketWhere,
        _count: { _all: true },
      }),
      prisma.ticket.groupBy({
        by: ["teamId"],
        where: ticketWhere,
        _count: { _all: true },
      }),
      prisma.conversation.groupBy({
        by: ["teamId"],
        where: conversationWhere,
        _count: { _all: true },
      }),
      prisma.team.findMany({
        where: { companyId },
        select: { id: true, name: true },
      }),
      prisma.auditLog.findMany({
        where: auditWhere,
        include: { actor: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 8,
      }),
    ]);

    return mapAnalyticsOverview({
      range: query.range,
      from,
      customerCount,
      conversationStatusGroups: conversationStatuses.map((group) => ({
        value: group.status,
        count: group._count._all,
      })),
      ticketStatusGroups: ticketStatuses.map((group) => ({
        value: group.status,
        count: group._count._all,
      })),
      attachmentCount,
      teamCount,
      conversationChannelGroups: conversationChannels.map((group) => ({
        value: group.channel,
        count: group._count._all,
      })),
      ticketPriorityGroups: ticketPriorities.map((group) => ({
        value: group.priority,
        count: group._count._all,
      })),
      ticketTeamGroups: ticketsByTeam.map((group) => ({
        teamId: group.teamId,
        count: group._count._all,
      })),
      conversationTeamGroups: conversationsByTeam.map((group) => ({
        teamId: group.teamId,
        count: group._count._all,
      })),
      teams,
      recentActivity,
    });
  }
}
