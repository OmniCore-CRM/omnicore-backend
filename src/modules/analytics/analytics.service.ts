import {
  ConversationChannel,
  Prisma,
  SlaStatus,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/config/db.js";
import { createAnalyticsCacheStore } from "@/core/cache/analytics-cache.js";
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

type DateTicketTrendRow = {
  day: Date;
  tickets: number;
  resolvedTickets: number;
  breachedTickets: number;
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

type ComputeResult = {
  value: ReturnType<typeof mapAnalyticsOverview>;
  batch1Ms: number;
  batch2Ms: number;
  batch3Ms: number;
  agentPerformanceMs: number;
  batch4Ms: number;
  comparisonMs: number;
  responseAssemblyMs: number;
};

export type AnalyticsOverviewCacheDiagnostics = {
  /** Backward-compatible: true for fresh and stale hits, false for miss. */
  cacheHit: boolean;
  /** SWR state for this response. */
  cacheState: "miss" | "fresh" | "stale";
  /** Which backing store served or attempted to serve the entry. */
  cacheSource: "redis" | "memory";
  keyHash: string;
  cacheEntryAgeMs: number | null;
  batch1Ms: number | null;
  batch2Ms: number | null;
  batch3Ms: number | null;
  agentPerformanceMs: number | null;
  batch4Ms: number | null;
  comparisonMs: number | null;
  responseAssemblyMs: number | null;
  totalServiceMs: number | null;
};

export class AnalyticsService {
  /** Shared SWR cache (Redis when configured, in-memory fallback otherwise). */
  private static readonly cacheStore = createAnalyticsCacheStore();

  /**
   * In-process deduplication map. Prevents concurrent requests in the same
   * process from each triggering a full cold-path computation.
   */
  private static readonly inFlightMap = new Map<
    string,
    Promise<ReturnType<typeof mapAnalyticsOverview>>
  >();

  private static cacheKey(
    companyId: string,
    window: { range: AnalyticsOverviewRange; from: Date | null; to: Date },
    filters: AnalyticsFilters,
    comparePrevious: boolean
  ) {
    // Custom ranges use exact start/end ISO strings (already stable).
    // Preset ranges use the string "preset" — the cache entry's freshUntil
    // timestamp controls staleness; the key must not include a rotating time
    // component, otherwise SWR stale hits can never occur.
    const windowKey =
      window.range === "custom"
        ? `${window.from?.toISOString() ?? "null"}:${window.to.toISOString()}`
        : "preset";

    return [
      companyId,
      window.range,
      windowKey,
      filters.teamId ?? "all-teams",
      filters.channel ?? "all-channels",
      filters.slaStatus ?? "all-sla",
      String(comparePrevious),
    ].join(":");
  }

  private static cacheKeyHash(key: string) {
    return createHash("sha256").update(key).digest("hex").slice(0, 12);
  }

  // ---- Public entry point ----

  static async overview(
    companyId: string,
    query: AnalyticsOverviewQueryInput,
    options?: {
      onCacheDiagnostics?: (diagnostics: AnalyticsOverviewCacheDiagnostics) => void;
    }
  ) {
    const serviceStartedAt = Date.now();
    const window = resolveWindow(query);
    const filters = resolveFilters(query);
    const previousWindow = comparisonWindow(window, query.comparePrevious ?? true);
    const key = this.cacheKey(companyId, window, filters, query.comparePrevious ?? true);
    const keyHash = this.cacheKeyHash(key);

    // 1. In-process coalescing: if the same key is already being computed in
    //    this process, await the existing promise instead of re-running queries.
    const inflight = this.inFlightMap.get(keyHash);
    if (inflight !== undefined) {
      const value = await inflight;
      options?.onCacheDiagnostics?.({
        cacheHit: false,
        cacheState: "miss",
        cacheSource: this.cacheStore.source,
        keyHash,
        cacheEntryAgeMs: null,
        batch1Ms: null,
        batch2Ms: null,
        batch3Ms: null,
        agentPerformanceMs: null,
        batch4Ms: null,
        comparisonMs: null,
        responseAssemblyMs: null,
        totalServiceMs: Date.now() - serviceStartedAt,
      });
      return value;
    }

    // 2. SWR cache lookup.
    const entry = await this.cacheStore.get(keyHash);
    const now = Date.now();

    if (entry !== null) {
      if (entry.freshUntil > now) {
        // FRESH HIT — serve directly, no DB work.
        const cacheEntryAgeMs = Math.max(
          0,
          now - (entry.freshUntil - analyticsOverviewCacheTtlMs)
        );
        options?.onCacheDiagnostics?.({
          cacheHit: true,
          cacheState: "fresh",
          cacheSource: this.cacheStore.source,
          keyHash,
          cacheEntryAgeMs,
          batch1Ms: null,
          batch2Ms: null,
          batch3Ms: null,
          agentPerformanceMs: null,
          batch4Ms: null,
          comparisonMs: null,
          responseAssemblyMs: null,
          totalServiceMs: Date.now() - serviceStartedAt,
        });
        return entry.value as ReturnType<typeof mapAnalyticsOverview>;
      }

      // STALE HIT — serve immediately, kick off background refresh.
      const cacheEntryAgeMs = now - entry.freshUntil;
      options?.onCacheDiagnostics?.({
        cacheHit: true,
        cacheState: "stale",
        cacheSource: this.cacheStore.source,
        keyHash,
        cacheEntryAgeMs,
        batch1Ms: null,
        batch2Ms: null,
        batch3Ms: null,
        agentPerformanceMs: null,
        batch4Ms: null,
        comparisonMs: null,
        responseAssemblyMs: null,
        totalServiceMs: Date.now() - serviceStartedAt,
      });
      void this.backgroundRefresh(keyHash, companyId, window, filters, previousWindow);
      return entry.value as ReturnType<typeof mapAnalyticsOverview>;
    }

    // 3. COLD MISS — compute with in-process coalescing + distributed lock.
    const computePromise = (async (): Promise<ComputeResult> => {
      // Try to acquire a distributed lock so only one process computes for this
      // key at a time. Proceed regardless — the inFlightMap already deduplicates
      // within-process, and a brief duplicate across processes is preferable to
      // blocking the user indefinitely.
      const lockAcquired = await this.cacheStore.acquireLock(keyHash);
      try {
        const result = await this.compute(companyId, window, filters, previousWindow);
        await this.cacheStore.set(keyHash, {
          freshUntil: Date.now() + analyticsOverviewCacheTtlMs,
          value: result.value,
        });
        return result;
      } finally {
        if (lockAcquired) {
          void this.cacheStore.releaseLock(keyHash);
        }
      }
    })();

    // Register the value promise so concurrent callers coalesce onto it.
    this.inFlightMap.set(keyHash, computePromise.then((r) => r.value));

    try {
      const result = await computePromise;
      options?.onCacheDiagnostics?.({
        cacheHit: false,
        cacheState: "miss",
        cacheSource: this.cacheStore.source,
        keyHash,
        cacheEntryAgeMs: null,
        batch1Ms: result.batch1Ms,
        batch2Ms: result.batch2Ms,
        batch3Ms: result.batch3Ms,
        agentPerformanceMs: result.agentPerformanceMs,
        batch4Ms: result.batch4Ms,
        comparisonMs: result.comparisonMs,
        responseAssemblyMs: result.responseAssemblyMs,
        totalServiceMs: Date.now() - serviceStartedAt,
      });
      return result.value;
    } finally {
      this.inFlightMap.delete(keyHash);
    }
  }

  // ---- Background SWR refresh ----

  private static async backgroundRefresh(
    keyHash: string,
    companyId: string,
    window: Window,
    filters: AnalyticsFilters,
    previousWindow: ReturnType<typeof comparisonWindow>
  ): Promise<void> {
    const lockAcquired = await this.cacheStore.acquireLock(keyHash);
    if (!lockAcquired) return;

    try {
      const result = await this.compute(companyId, window, filters, previousWindow);
      await this.cacheStore.set(keyHash, {
        freshUntil: Date.now() + analyticsOverviewCacheTtlMs,
        value: result.value,
      });
      console.info(
        JSON.stringify({
          level: "info",
          event: "analytics_cache_refresh_completed",
          keyHash,
        })
      );
    } catch (error) {
      // Stale entry remains; the next stale hit will retry.
      console.info(
        JSON.stringify({
          level: "warn",
          event: "analytics_cache_refresh_failed",
          keyHash,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      void this.cacheStore.releaseLock(keyHash);
    }
  }

  // ---- Core compute — all batch queries and response assembly ----

  private static async compute(
    companyId: string,
    window: Window,
    filters: AnalyticsFilters,
    previousWindow: ReturnType<typeof comparisonWindow>
  ): Promise<ComputeResult> {
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
    // Batch 1: Simple counts and core status groups (4 queries)
    const batch1StartedAt = Date.now();
    const [customerCount, attachmentCount, conversationStatuses, ticketStatuses] =
      await Promise.all([
        prisma.customer.count({ where: customerWhere }),
        prisma.attachment.count({ where: attachmentWhere }),
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
    const batch1Ms = Date.now() - batch1StartedAt;

    // Batch 2: GroupBy operations (4 queries)
    const batch2StartedAt = Date.now();
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
    const batch2Ms = Date.now() - batch2StartedAt;

    // Batch 3: More queries and complex operations (3-4 queries)
    const batch3StartedAt = Date.now();
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
    const batch3Ms = Date.now() - batch3StartedAt;

    const teamCount = teams.length;

    // Agent performance merged with Batch 4 as one conservative wave.
    const agentPerformanceStartedAt = Date.now();
    const agentPerformancePromise = fetchAgentPerformance(
      companyId,
      window,
      filters
    ).then((value) => ({
      value,
      ms: Date.now() - agentPerformanceStartedAt,
    }));

    // Batch 4: Consolidated daily aggregates and team/channel trends
    const batch4StartedAt = Date.now();
    const [
      agentPerformanceResult,
      ticketDailyTrends,
      channelDaily,
      ticketTeamDaily,
      conversationTeamDaily,
    ] = await Promise.all([
      agentPerformancePromise,
      prisma.$queryRaw<DateTicketTrendRow[]>`
        WITH ticket_totals AS (
          SELECT
            date_trunc('day', t."createdAt")::date AS "day",
            COUNT(*)::int AS "tickets",
            COUNT(*) FILTER (WHERE t."slaStatus" = 'BREACHED')::int AS "breachedTickets"
          FROM "Ticket" t
          LEFT JOIN "Conversation" c
            ON c."id" = t."conversationId"
           AND c."companyId" = t."companyId"
          WHERE ${rawWhere("t", companyId, window, filters)}
          GROUP BY 1
        ),
        resolved_totals AS (
          SELECT
            date_trunc('day', t."resolvedAt")::date AS "day",
            COUNT(*)::int AS "resolvedTickets"
          FROM "Ticket" t
          LEFT JOIN "Conversation" c
            ON c."id" = t."conversationId"
           AND c."companyId" = t."companyId"
          WHERE ${rawWhere("t", companyId, window, filters)}
            AND t."resolvedAt" IS NOT NULL
            AND t."resolvedAt" <= ${window.to}
            ${window.from ? Prisma.sql`AND t."resolvedAt" >= ${window.from}` : Prisma.empty}
          GROUP BY 1
        )
        SELECT
          COALESCE(tt."day", rt."day") AS "day",
          COALESCE(tt."tickets", 0)::int AS "tickets",
          COALESCE(rt."resolvedTickets", 0)::int AS "resolvedTickets",
          COALESCE(tt."breachedTickets", 0)::int AS "breachedTickets"
        FROM ticket_totals tt
        FULL OUTER JOIN resolved_totals rt
          ON rt."day" = tt."day"
      `,
      prisma.$queryRaw<DateChannelCountRow[]>`
        SELECT date_trunc('day', c."createdAt")::date AS "day", c."channel" AS "channel", COUNT(*)::int AS "count"
        FROM "Conversation" c
        WHERE c."companyId" = ${companyId}
          AND c."createdAt" <= ${window.to}
          ${window.from ? Prisma.sql`AND c."createdAt" >= ${window.from}` : Prisma.empty}
          ${filters.teamId ? Prisma.sql`AND c."teamId" = ${filters.teamId}` : Prisma.empty}
          ${filters.channel ? Prisma.sql`AND c."channel" = ${filters.channel}::"ConversationChannel"` : Prisma.empty}
        GROUP BY 1, 2
      `,
      prisma.$queryRaw<DateTeamCountRow[]>`
        SELECT date_trunc('day', t."createdAt")::date AS "day", t."teamId" AS "teamId", COUNT(*)::int AS "count"
        FROM "Ticket" t
        LEFT JOIN "Conversation" c
          ON c."id" = t."conversationId"
         AND c."companyId" = t."companyId"
        WHERE ${rawWhere("t", companyId, window, filters)}
        GROUP BY 1, 2
      `,
      prisma.$queryRaw<DateTeamCountRow[]>`
        SELECT date_trunc('day', c."createdAt")::date AS "day", c."teamId" AS "teamId", COUNT(*)::int AS "count"
        FROM "Conversation" c
        WHERE c."companyId" = ${companyId}
          AND c."createdAt" <= ${window.to}
          ${window.from ? Prisma.sql`AND c."createdAt" >= ${window.from}` : Prisma.empty}
          ${filters.teamId ? Prisma.sql`AND c."teamId" = ${filters.teamId}` : Prisma.empty}
          ${filters.channel ? Prisma.sql`AND c."channel" = ${filters.channel}::"ConversationChannel"` : Prisma.empty}
        GROUP BY 1, 2
      `,
    ]);
    const agentPerformance = agentPerformanceResult.value;
    const agentPerformanceMs = agentPerformanceResult.ms;
    const batch4Ms = Date.now() - batch4StartedAt;

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

    const comparisonStartedAt = Date.now();

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
    const comparisonMs = Date.now() - comparisonStartedAt;

    const responseAssemblyStartedAt = Date.now();
    const buckets = dateBuckets(window.from, window.to);

    const conversationDailyMap = new Map<string, number>();
    const channelTrendMap = new Map<ConversationChannel, Map<string, number>>();
    for (const row of channelDaily) {
      const day = toIsoDay(row.day);
      const count = Number(row.count);
      conversationDailyMap.set(day, (conversationDailyMap.get(day) ?? 0) + count);

      const byDate = channelTrendMap.get(row.channel) ?? new Map<string, number>();
      byDate.set(day, count);
      channelTrendMap.set(row.channel, byDate);
    }

    const ticketDailyMap = new Map<string, number>();
    const resolvedDailyMap = new Map<string, number>();
    const breachedDailyMap = new Map<string, number>();
    for (const row of ticketDailyTrends) {
      const day = toIsoDay(row.day);
      ticketDailyMap.set(day, Number(row.tickets));
      resolvedDailyMap.set(day, Number(row.resolvedTickets));
      breachedDailyMap.set(day, Number(row.breachedTickets));
    }

    const trendsDaily = buckets.map((date) => ({
      date,
      conversations: conversationDailyMap.get(date) ?? 0,
      tickets: ticketDailyMap.get(date) ?? 0,
      resolvedTickets: resolvedDailyMap.get(date) ?? 0,
      breachedTickets: breachedDailyMap.get(date) ?? 0,
    }));

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

    const responseAssemblyMs = Date.now() - responseAssemblyStartedAt;

    return {
      value: mapped,
      batch1Ms,
      batch2Ms,
      batch3Ms,
      agentPerformanceMs,
      batch4Ms,
      comparisonMs,
      responseAssemblyMs,
    };
  }
}
