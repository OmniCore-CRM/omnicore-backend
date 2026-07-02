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

const analyticsOverviewCacheTtlMs = 30_000;

type AnalyticsOverviewCacheEntry = {
  expiresAt: number;
  value: ReturnType<typeof mapAnalyticsOverview>;
};

export class AnalyticsService {
  private static readonly overviewCache = new Map<
    string,
    AnalyticsOverviewCacheEntry
  >();

  private static cacheKey(companyId: string, range: AnalyticsRange) {
    return `${companyId}:${range}`;
  }

  static async overview(
    companyId: string,
    query: AnalyticsOverviewQueryInput
  ) {
    const key = this.cacheKey(companyId, query.range);
    const cached = this.overviewCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

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
        take: 8,
      }),
    ]);

    const mapped = mapAnalyticsOverview({
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

    this.overviewCache.set(key, {
      expiresAt: Date.now() + analyticsOverviewCacheTtlMs,
      value: mapped,
    });

    return mapped;
  }
}
