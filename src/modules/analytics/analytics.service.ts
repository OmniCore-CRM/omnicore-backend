import {
  ConversationChannel,
  Prisma,
  SlaStatus,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { mapAnalyticsOverview } from "./analytics.mapper.js";
import type {
  AnalyticsOverviewQueryInput,
  AnalyticsRange,
} from "./analytics.validation.js";

type AnalyticsOverviewRange = AnalyticsRange | "custom";

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

const parseIsoDayStart = (value: string) =>
  new Date(`${value}T00:00:00.000Z`);

const parseIsoDayEnd = (value: string) =>
  new Date(`${value}T23:59:59.999Z`);

const createdAtWhere = (from: Date | null, to: Date) =>
  from
    ? { createdAt: { gte: from, lte: to } }
    : { createdAt: { lte: to } };

const resolveWindow = (query: AnalyticsOverviewQueryInput): {
  range: AnalyticsOverviewRange;
  from: Date | null;
  to: Date;
} => {
  if (query.startDate && query.endDate) {
    return {
      range: "custom",
      from: parseIsoDayStart(query.startDate),
      to: parseIsoDayEnd(query.endDate),
    };
  }

  return {
    range: query.range,
    from: getRangeStart(query.range),
    to: new Date(),
  };
};

const analyticsOverviewCacheTtlMs = 30_000;

type AnalyticsFilters = {
  teamId: string | null;
  channel: ConversationChannel | null;
  slaStatus: SlaStatus | null;
};

type Window = {
  range: AnalyticsOverviewRange;
  from: Date | null;
  to: Date;
};

type TicketTimingAggregateRow = {
  firstResponseCount: number;
  firstResponseAvgMinutes: number | null;
  resolutionCount: number;
  resolutionAvgMinutes: number | null;
};

type AgentPerformanceRow = {
  assigneeId: string;
  firstName: string | null;
  lastName: string | null;
  assignedTickets: number;
  resolvedTickets: number;
  breachedTickets: number;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
};

type DateCountRow = {
  day: Date;
  count: number;
};

type DateChannelCountRow = {
  day: Date;
  channel: ConversationChannel;
  count: number;
};

type DateTeamCountRow = {
  day: Date;
  teamId: string | null;
  count: number;
};

const toIsoDay = (value: Date) => value.toISOString().slice(0, 10);

const safeNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : value === null || value === undefined
      ? null
      : Number.isFinite(Number(value))
        ? Number(value)
        : null;

const createdAtWindow = (window: Window) =>
  window.from
    ? { gte: window.from, lte: window.to }
    : { lte: window.to };

const resolveFilters = (query: AnalyticsOverviewQueryInput): AnalyticsFilters => ({
  teamId: query.teamId ?? null,
  channel: query.channel ?? null,
  slaStatus: query.slaStatus ?? null,
});

const buildConversationWhere = (
  companyId: string,
  window: Window,
  filters: AnalyticsFilters
): Prisma.ConversationWhereInput => ({
  companyId,
  createdAt: createdAtWindow(window),
  ...(filters.teamId ? { teamId: filters.teamId } : {}),
  ...(filters.channel ? { channel: filters.channel } : {}),
});

const buildTicketWhere = (
  companyId: string,
  window: Window,
  filters: AnalyticsFilters
): Prisma.TicketWhereInput => ({
  companyId,
  createdAt: createdAtWindow(window),
  ...(filters.teamId ? { teamId: filters.teamId } : {}),
  ...(filters.slaStatus ? { slaStatus: filters.slaStatus } : {}),
  ...(filters.channel
    ? {
        conversation: {
          is: {
            companyId,
            channel: filters.channel,
          },
        },
      }
    : {}),
});

const comparisonWindow = (window: Window, comparePrevious: boolean) => {
  if (!comparePrevious || !window.from) return null;

  const durationMs = window.to.getTime() - window.from.getTime() + 1;
  const previousTo = new Date(window.from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - durationMs + 1);

  return {
    range: "custom" as const,
    from: previousFrom,
    to: previousTo,
  };
};

const dateBuckets = (from: Date | null, to: Date) => {
  const start = from ?? new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  const buckets: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

  while (cursor.getTime() <= end.getTime()) {
    buckets.push(toIsoDay(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return buckets;
};

const rawWhere = (
  alias: string,
  companyId: string,
  window: Window,
  filters: AnalyticsFilters
) => {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`${Prisma.raw(alias)}."companyId" = ${companyId}`,
    Prisma.sql`${Prisma.raw(alias)}."createdAt" <= ${window.to}`,
  ];

  if (window.from) {
    clauses.push(Prisma.sql`${Prisma.raw(alias)}."createdAt" >= ${window.from}`);
  }

  if (filters.teamId) {
    clauses.push(Prisma.sql`${Prisma.raw(alias)}."teamId" = ${filters.teamId}`);
  }

  if (filters.slaStatus) {
    clauses.push(Prisma.sql`${Prisma.raw(alias)}."slaStatus" = ${filters.slaStatus}::"SlaStatus"`);
  }

  if (filters.channel) {
    clauses.push(Prisma.sql`c."channel" = ${filters.channel}::"ConversationChannel"`);
  }

  return Prisma.join(clauses, " AND ");
};

const fetchTicketTiming = async (
  companyId: string,
  window: Window,
  filters: AnalyticsFilters
) => {
  const rows = await prisma.$queryRaw<TicketTimingAggregateRow[]>`
    SELECT
      COUNT(*) FILTER (WHERE t."firstRespondedAt" IS NOT NULL)::int AS "firstResponseCount",
      AVG(EXTRACT(EPOCH FROM (t."firstRespondedAt" - t."createdAt")) / 60)
        FILTER (WHERE t."firstRespondedAt" IS NOT NULL) AS "firstResponseAvgMinutes",
      COUNT(*) FILTER (WHERE t."resolvedAt" IS NOT NULL)::int AS "resolutionCount",
      AVG(EXTRACT(EPOCH FROM (t."resolvedAt" - t."createdAt")) / 60)
        FILTER (WHERE t."resolvedAt" IS NOT NULL) AS "resolutionAvgMinutes"
    FROM "Ticket" t
    LEFT JOIN "Conversation" c
      ON c."id" = t."conversationId"
     AND c."companyId" = t."companyId"
    WHERE ${rawWhere("t", companyId, window, filters)}
  `;

  const row = rows[0];
  return {
    firstResponseCount: row?.firstResponseCount ?? 0,
    firstResponseAvgMinutes:
      (safeNumber(row?.firstResponseAvgMinutes) as number | null) ?? null,
    resolutionCount: row?.resolutionCount ?? 0,
    resolutionAvgMinutes:
      (safeNumber(row?.resolutionAvgMinutes) as number | null) ?? null,
  };
};

const fetchAgentPerformance = async (
  companyId: string,
  window: Window,
  filters: AnalyticsFilters
) => {
  const rows = await prisma.$queryRaw<AgentPerformanceRow[]>`
    SELECT
      t."assigneeId" AS "assigneeId",
      u."firstName" AS "firstName",
      u."lastName" AS "lastName",
      COUNT(*)::int AS "assignedTickets",
      COUNT(*) FILTER (
        WHERE t."status" IN ('RESOLVED'::"TicketStatus", 'CLOSED'::"TicketStatus")
      )::int AS "resolvedTickets",
      COUNT(*) FILTER (WHERE t."slaStatus" = 'BREACHED')::int AS "breachedTickets",
      AVG(EXTRACT(EPOCH FROM (t."firstRespondedAt" - t."createdAt")) / 60)
        FILTER (WHERE t."firstRespondedAt" IS NOT NULL) AS "avgFirstResponseMinutes",
      AVG(EXTRACT(EPOCH FROM (t."resolvedAt" - t."createdAt")) / 60)
        FILTER (WHERE t."resolvedAt" IS NOT NULL) AS "avgResolutionMinutes"
    FROM "Ticket" t
    LEFT JOIN "User" u
      ON u."id" = t."assigneeId"
     AND u."companyId" = t."companyId"
    LEFT JOIN "Conversation" c
      ON c."id" = t."conversationId"
     AND c."companyId" = t."companyId"
    WHERE ${rawWhere("t", companyId, window, filters)}
      AND t."assigneeId" IS NOT NULL
    GROUP BY t."assigneeId", u."firstName", u."lastName"
    ORDER BY "assignedTickets" DESC, "resolvedTickets" DESC
    LIMIT 10
  `;

  return rows.map((row) => ({
    assigneeId: row.assigneeId,
    name: [row.firstName, row.lastName].filter(Boolean).join(" ") || "Unassigned user",
    assignedTickets: row.assignedTickets,
    resolvedTickets: row.resolvedTickets,
    breachedTickets: row.breachedTickets,
    avgFirstResponseMinutes:
      (safeNumber(row.avgFirstResponseMinutes) as number | null) ?? null,
    avgResolutionMinutes:
      (safeNumber(row.avgResolutionMinutes) as number | null) ?? null,
  }));
};

const toDailyMap = <T extends { day: Date; count: number }>(rows: T[]) => {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(toIsoDay(row.day), Number(row.count));
  }
  return map;
};

type AnalyticsOverviewCacheEntry = {
  expiresAt: number;
  value: ReturnType<typeof mapAnalyticsOverview>;
};

export class AnalyticsService {
  private static readonly overviewCache = new Map<
    string,
    AnalyticsOverviewCacheEntry
  >();

  private static cacheKey(
    companyId: string,
    window: { range: AnalyticsOverviewRange; from: Date | null; to: Date },
    filters: AnalyticsFilters,
    comparePrevious: boolean
  ) {
    return [
      companyId,
      window.range,
      window.from?.toISOString() ?? "null",
      window.to.toISOString(),
      filters.teamId ?? "all-teams",
      filters.channel ?? "all-channels",
      filters.slaStatus ?? "all-sla",
      String(comparePrevious),
    ].join(":");
  }

  static async overview(
    companyId: string,
    query: AnalyticsOverviewQueryInput
  ) {
    const window = resolveWindow(query);
    const filters = resolveFilters(query);
    const previousWindow = comparisonWindow(window, query.comparePrevious ?? true);
    const key = this.cacheKey(companyId, window, filters, query.comparePrevious ?? true);
    const cached = this.overviewCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const customerWhere: Prisma.CustomerWhereInput = {
      companyId,
      ...createdAtWhere(window.from, window.to),
    };
    const conversationWhere = buildConversationWhere(companyId, window, filters);
    const ticketWhere = buildTicketWhere(companyId, window, filters);
    const attachmentWhere: Prisma.AttachmentWhereInput = {
      companyId,
      ...createdAtWhere(window.from, window.to),
    };
    const auditWhere: Prisma.AuditLogWhereInput = {
      companyId,
      ...createdAtWhere(window.from, window.to),
    };

    // Priority 1 optimization: Conservative parallelization in batches
    // Batch 1: Simple counts (5 queries)
    const [customerCount, attachmentCount, teamCount, conversationStatuses, ticketStatuses] =
      await Promise.all([
        prisma.customer.count({ where: customerWhere }),
        prisma.attachment.count({ where: attachmentWhere }),
        prisma.team.count({ where: { companyId } }),
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
      ]);

    // Batch 2: GroupBy operations (4 queries)
    const [conversationChannels, ticketPriorities, slaGroups, ticketsByTeam] =
      await Promise.all([
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
          by: ["slaStatus"],
          where: ticketWhere,
          _count: { _all: true },
        }),
        prisma.ticket.groupBy({
          by: ["teamId"],
          where: ticketWhere,
          _count: { _all: true },
        }),
      ]);

    // Batch 3: More queries and complex operations (3-4 queries)
    const [conversationsByTeam, teams, recentActivity, ticketTiming] =
      await Promise.all([
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
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 8,
        }),
        fetchTicketTiming(companyId, window, filters),
      ]);

    // Agent performance and daily aggregates
    const agentPerformance = await fetchAgentPerformance(companyId, window, filters);

    // Batch 4: Daily aggregates and expensive queries (stay sequential or small batch)
    // These are raw SQL queries that might compete for resources
    const conversationDaily = await prisma.$queryRaw<DateCountRow[]>`
        SELECT date_trunc('day', c."createdAt")::date AS "day", COUNT(*)::int AS "count"
        FROM "Conversation" c
        WHERE c."companyId" = ${companyId}
          AND c."createdAt" <= ${window.to}
          ${window.from ? Prisma.sql`AND c."createdAt" >= ${window.from}` : Prisma.empty}
          ${filters.teamId ? Prisma.sql`AND c."teamId" = ${filters.teamId}` : Prisma.empty}
          ${filters.channel ? Prisma.sql`AND c."channel" = ${filters.channel}::"ConversationChannel"` : Prisma.empty}
        GROUP BY 1
      `;
    const ticketDaily = await prisma.$queryRaw<DateCountRow[]>`
        SELECT date_trunc('day', t."createdAt")::date AS "day", COUNT(*)::int AS "count"
        FROM "Ticket" t
        LEFT JOIN "Conversation" c
          ON c."id" = t."conversationId"
         AND c."companyId" = t."companyId"
        WHERE ${rawWhere("t", companyId, window, filters)}
        GROUP BY 1
      `;
    const resolvedDaily = await prisma.$queryRaw<DateCountRow[]>`
        SELECT date_trunc('day', t."resolvedAt")::date AS "day", COUNT(*)::int AS "count"
        FROM "Ticket" t
        LEFT JOIN "Conversation" c
          ON c."id" = t."conversationId"
         AND c."companyId" = t."companyId"
        WHERE ${rawWhere("t", companyId, window, filters)}
          AND t."resolvedAt" IS NOT NULL
          AND t."resolvedAt" <= ${window.to}
          ${window.from ? Prisma.sql`AND t."resolvedAt" >= ${window.from}` : Prisma.empty}
        GROUP BY 1
      `;
    const breachedDaily = await prisma.$queryRaw<DateCountRow[]>`
        SELECT date_trunc('day', t."createdAt")::date AS "day", COUNT(*)::int AS "count"
        FROM "Ticket" t
        LEFT JOIN "Conversation" c
          ON c."id" = t."conversationId"
         AND c."companyId" = t."companyId"
        WHERE ${rawWhere("t", companyId, window, filters)}
          AND t."slaStatus" = 'BREACHED'
        GROUP BY 1
      `;
    const channelDaily = await prisma.$queryRaw<DateChannelCountRow[]>`
        SELECT date_trunc('day', c."createdAt")::date AS "day", c."channel" AS "channel", COUNT(*)::int AS "count"
        FROM "Conversation" c
        WHERE c."companyId" = ${companyId}
          AND c."createdAt" <= ${window.to}
          ${window.from ? Prisma.sql`AND c."createdAt" >= ${window.from}` : Prisma.empty}
          ${filters.teamId ? Prisma.sql`AND c."teamId" = ${filters.teamId}` : Prisma.empty}
          ${filters.channel ? Prisma.sql`AND c."channel" = ${filters.channel}::"ConversationChannel"` : Prisma.empty}
        GROUP BY 1, 2
      `;
    const ticketTeamDaily = await prisma.$queryRaw<DateTeamCountRow[]>`
        SELECT date_trunc('day', t."createdAt")::date AS "day", t."teamId" AS "teamId", COUNT(*)::int AS "count"
        FROM "Ticket" t
        LEFT JOIN "Conversation" c
          ON c."id" = t."conversationId"
         AND c."companyId" = t."companyId"
        WHERE ${rawWhere("t", companyId, window, filters)}
        GROUP BY 1, 2
      `;
    const conversationTeamDaily = await prisma.$queryRaw<DateTeamCountRow[]>`
        SELECT date_trunc('day', c."createdAt")::date AS "day", c."teamId" AS "teamId", COUNT(*)::int AS "count"
        FROM "Conversation" c
        WHERE c."companyId" = ${companyId}
          AND c."createdAt" <= ${window.to}
          ${window.from ? Prisma.sql`AND c."createdAt" >= ${window.from}` : Prisma.empty}
          ${filters.teamId ? Prisma.sql`AND c."teamId" = ${filters.teamId}` : Prisma.empty}
          ${filters.channel ? Prisma.sql`AND c."channel" = ${filters.channel}::"ConversationChannel"` : Prisma.empty}
        GROUP BY 1, 2
      `;

    let previousComparison: {
      from: Date;
      to: Date;
      totalConversations: number;
      totalTickets: number;
      resolvedClosedTickets: number;
      breachedTickets: number;
      firstResponseAvgMinutes: number | null;
      resolutionAvgMinutes: number | null;
    } | null = null;

    if (previousWindow) {
      const [prevConversationStatuses, prevTicketStatuses, prevSlaGroups, prevTiming] =
        await Promise.all([
          prisma.conversation.groupBy({
            by: ["status"],
            where: buildConversationWhere(companyId, previousWindow, filters),
            _count: { _all: true },
          }),
          prisma.ticket.groupBy({
            by: ["status"],
            where: buildTicketWhere(companyId, previousWindow, filters),
            _count: { _all: true },
          }),
          prisma.ticket.groupBy({
            by: ["slaStatus"],
            where: buildTicketWhere(companyId, previousWindow, filters),
            _count: { _all: true },
          }),
          fetchTicketTiming(companyId, previousWindow, filters),
        ]);

      const prevTotalConversations = prevConversationStatuses.reduce(
        (total, group) => total + group._count._all,
        0
      );
      const prevTotalTickets = prevTicketStatuses.reduce(
        (total, group) => total + group._count._all,
        0
      );
      const prevResolvedClosedTickets = prevTicketStatuses
        .filter((group) =>
          group.status === "RESOLVED" || group.status === "CLOSED"
        )
        .reduce((total, group) => total + group._count._all, 0);
      const prevBreachedTickets = prevSlaGroups
        .filter((group) => group.slaStatus === "BREACHED")
        .reduce((total, group) => total + group._count._all, 0);

      previousComparison = {
        from: previousWindow.from,
        to: previousWindow.to,
        totalConversations: prevTotalConversations,
        totalTickets: prevTotalTickets,
        resolvedClosedTickets: prevResolvedClosedTickets,
        breachedTickets: prevBreachedTickets,
        firstResponseAvgMinutes: prevTiming.firstResponseAvgMinutes,
        resolutionAvgMinutes: prevTiming.resolutionAvgMinutes,
      };
    }

    const buckets = dateBuckets(window.from, window.to);
    const conversationDailyMap = toDailyMap(conversationDaily);
    const ticketDailyMap = toDailyMap(ticketDaily);
    const resolvedDailyMap = toDailyMap(resolvedDaily);
    const breachedDailyMap = toDailyMap(breachedDaily);

    const trendsDaily = buckets.map((date) => ({
      date,
      conversations: conversationDailyMap.get(date) ?? 0,
      tickets: ticketDailyMap.get(date) ?? 0,
      resolvedTickets: resolvedDailyMap.get(date) ?? 0,
      breachedTickets: breachedDailyMap.get(date) ?? 0,
    }));

    const channelTrendMap = new Map<ConversationChannel, Map<string, number>>();
    for (const row of channelDaily) {
      const byDate = channelTrendMap.get(row.channel) ?? new Map<string, number>();
      byDate.set(toIsoDay(row.day), Number(row.count));
      channelTrendMap.set(row.channel, byDate);
    }

    const trendsChannels = Array.from(channelTrendMap.entries()).map(
      ([channel, byDate]) => ({
        channel,
        points: buckets.map((date) => ({
          date,
          count: byDate.get(date) ?? 0,
        })),
      })
    );

    const teamNames = new Map(teams.map((team) => [team.id, team.name]));
    const teamTrendMap = new Map<
      string,
      {
        teamId: string | null;
        name: string;
        tickets: Map<string, number>;
        conversations: Map<string, number>;
      }
    >();

    const teamKey = (teamId: string | null) => teamId ?? "unassigned";

    for (const row of ticketTeamDaily) {
      const keyForTeam = teamKey(row.teamId);
      const current =
        teamTrendMap.get(keyForTeam) ?? {
          teamId: row.teamId,
          name: row.teamId ? teamNames.get(row.teamId) ?? "Unknown team" : "Unassigned",
          tickets: new Map<string, number>(),
          conversations: new Map<string, number>(),
        };
      current.tickets.set(toIsoDay(row.day), Number(row.count));
      teamTrendMap.set(keyForTeam, current);
    }

    for (const row of conversationTeamDaily) {
      const keyForTeam = teamKey(row.teamId);
      const current =
        teamTrendMap.get(keyForTeam) ?? {
          teamId: row.teamId,
          name: row.teamId ? teamNames.get(row.teamId) ?? "Unknown team" : "Unassigned",
          tickets: new Map<string, number>(),
          conversations: new Map<string, number>(),
        };
      current.conversations.set(toIsoDay(row.day), Number(row.count));
      teamTrendMap.set(keyForTeam, current);
    }

    const trendsTeams = Array.from(teamTrendMap.values())
      .map((item) => ({
        teamId: item.teamId,
        name: item.name,
        points: buckets.map((date) => ({
          date,
          tickets: item.tickets.get(date) ?? 0,
          conversations: item.conversations.get(date) ?? 0,
        })),
        total:
          Array.from(item.tickets.values()).reduce((sum, count) => sum + count, 0) +
          Array.from(item.conversations.values()).reduce((sum, count) => sum + count, 0),
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      .slice(0, 8)
      .map(({ total: _total, ...rest }) => rest);

    const mapped = mapAnalyticsOverview({
      range: window.range,
      from: window.from,
      to: window.to,
      filters,
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
      slaGroups: slaGroups.map((group) => ({
        value: group.slaStatus,
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
      firstResponseAvgMinutes: ticketTiming.firstResponseAvgMinutes,
      resolutionAvgMinutes: ticketTiming.resolutionAvgMinutes,
      firstResponseCount: ticketTiming.firstResponseCount,
      resolutionCount: ticketTiming.resolutionCount,
      agentPerformance,
      trends: {
        daily: trendsDaily,
        channels: trendsChannels,
        teams: trendsTeams,
      },
      comparison: {
        previous: previousComparison,
        deltas: null,
      },
    });

    this.overviewCache.set(key, {
      expiresAt: Date.now() + analyticsOverviewCacheTtlMs,
      value: mapped,
    });

    return mapped;
  }
}
