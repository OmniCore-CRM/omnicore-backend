import type {
  AuditLog,
  ConversationChannel,
  ConversationStatus,
  SlaStatus,
  TicketPriority,
  TicketStatus,
  User,
} from "@prisma/client";
import type { AnalyticsRange } from "./analytics.validation.js";

type AnalyticsOverviewRange = AnalyticsRange | "custom";

type CountGroup<T extends string> = {
  value: T;
  count: number;
};

type TeamCount = {
  teamId: string | null;
  count: number;
};

type TeamSummary = {
  id: string;
  name: string;
};

type SafeActor = Pick<User, "id" | "firstName" | "lastName">;

type RecentAuditLog = AuditLog & {
  actor: SafeActor | null;
};

type AnalyticsOverviewInput = {
  range: AnalyticsOverviewRange;
  from: Date | null;
  to: Date;
  filters: {
    teamId: string | null;
    channel: ConversationChannel | null;
    slaStatus: SlaStatus | null;
  };
  customerCount: number;
  conversationStatusGroups: CountGroup<ConversationStatus>[];
  ticketStatusGroups: CountGroup<TicketStatus>[];
  attachmentCount: number;
  teamCount: number;
  conversationChannelGroups: CountGroup<ConversationChannel>[];
  ticketPriorityGroups: CountGroup<TicketPriority>[];
  ticketTeamGroups: TeamCount[];
  conversationTeamGroups: TeamCount[];
  teams: TeamSummary[];
  recentActivity: RecentAuditLog[];
  firstResponseAvgMinutes: number | null;
  resolutionAvgMinutes: number | null;
  firstResponseCount: number;
  resolutionCount: number;
  slaGroups: CountGroup<SlaStatus>[];
  agentPerformance: Array<{
    assigneeId: string;
    name: string;
    assignedTickets: number;
    resolvedTickets: number;
    breachedTickets: number;
    avgFirstResponseMinutes: number | null;
    avgResolutionMinutes: number | null;
  }>;
  trends: {
    daily: Array<{
      date: string;
      conversations: number;
      tickets: number;
      resolvedTickets: number;
      breachedTickets: number;
    }>;
    channels: Array<{
      channel: ConversationChannel;
      points: Array<{ date: string; count: number }>;
    }>;
    teams: Array<{
      teamId: string | null;
      name: string;
      points: Array<{ date: string; tickets: number; conversations: number }>;
    }>;
  };
  comparison: {
    previous: {
      from: Date;
      to: Date;
      totalConversations: number;
      totalTickets: number;
      resolvedClosedTickets: number;
      breachedTickets: number;
      firstResponseAvgMinutes: number | null;
      resolutionAvgMinutes: number | null;
    } | null;
    deltas: {
      totalConversationsPct: number | null;
      totalTicketsPct: number | null;
      resolvedClosedTicketsPct: number | null;
      breachedTicketsPct: number | null;
      firstResponseAvgMinutesPct: number | null;
      resolutionAvgMinutesPct: number | null;
    } | null;
  };
};

const countFor = <T extends string>(groups: CountGroup<T>[], value: T) =>
  groups.find((group) => group.value === value)?.count ?? 0;

const mapBreakdown = <T extends string>(groups: CountGroup<T>[]) =>
  groups
    .map((group) => ({
      key: group.value,
      count: group.count,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

const mapTeamCounts = (groups: TeamCount[], teams: TeamSummary[]) => {
  const names = new Map(teams.map((team) => [team.id, team.name]));
  return groups
    .map((group) => ({
      teamId: group.teamId,
      name: group.teamId
        ? names.get(group.teamId) ?? "Unknown team"
        : "Unassigned",
      count: group.count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

const mapRecentActivity = (logs: RecentAuditLog[]) =>
  logs.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actor: log.actor
      ? {
          id: log.actor.id,
          displayName: [log.actor.firstName, log.actor.lastName]
            .filter(Boolean)
            .join(" "),
        }
      : null,
    createdAt: log.createdAt,
  }));

const round2 = (value: number | null) =>
  value === null ? null : Math.round(value * 100) / 100;

const percentChange = (current: number, previous: number) => {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }

  return round2(((current - previous) / previous) * 100);
};

const percentChangeNullable = (
  current: number | null,
  previous: number | null
) => {
  if (current === null || previous === null) return null;
  return percentChange(current, previous);
};

export const mapAnalyticsOverview = (input: AnalyticsOverviewInput) => {
  const totalConversations = input.conversationStatusGroups.reduce(
    (total, group) => total + group.count,
    0
  );
  const totalTickets = input.ticketStatusGroups.reduce(
    (total, group) => total + group.count,
    0
  );

  const resolvedClosedTickets =
    countFor(input.ticketStatusGroups, "RESOLVED") +
    countFor(input.ticketStatusGroups, "CLOSED");
  const breachedTickets = countFor(input.slaGroups, "BREACHED");
  const trackedSlaTickets = input.slaGroups.reduce(
    (total, group) => total + group.count,
    0
  );
  const slaComplianceRatePct =
    trackedSlaTickets === 0
      ? null
      : round2(
          ((countFor(input.slaGroups, "ON_TRACK") +
            countFor(input.slaGroups, "AT_RISK") +
            countFor(input.slaGroups, "PAUSED")) /
            trackedSlaTickets) *
            100
        );

  const deltas = input.comparison.deltas
    ? {
        totalConversationsPct: input.comparison.deltas.totalConversationsPct,
        totalTicketsPct: input.comparison.deltas.totalTicketsPct,
        resolvedClosedTicketsPct: input.comparison.deltas.resolvedClosedTicketsPct,
        breachedTicketsPct: input.comparison.deltas.breachedTicketsPct,
        firstResponseAvgMinutesPct:
          input.comparison.deltas.firstResponseAvgMinutesPct,
        resolutionAvgMinutesPct: input.comparison.deltas.resolutionAvgMinutesPct,
      }
    : input.comparison.previous
      ? {
          totalConversationsPct: percentChange(
            totalConversations,
            input.comparison.previous.totalConversations
          ),
          totalTicketsPct: percentChange(
            totalTickets,
            input.comparison.previous.totalTickets
          ),
          resolvedClosedTicketsPct: percentChange(
            resolvedClosedTickets,
            input.comparison.previous.resolvedClosedTickets
          ),
          breachedTicketsPct: percentChange(
            breachedTickets,
            input.comparison.previous.breachedTickets
          ),
          firstResponseAvgMinutesPct: percentChangeNullable(
            input.firstResponseAvgMinutes,
            input.comparison.previous.firstResponseAvgMinutes
          ),
          resolutionAvgMinutesPct: percentChangeNullable(
            input.resolutionAvgMinutes,
            input.comparison.previous.resolutionAvgMinutes
          ),
        }
      : null;

  return {
    range: input.range,
    period: {
      from: input.from,
      to: input.to,
    },
    filters: input.filters,
    summary: {
      totalCustomers: input.customerCount,
      totalConversations,
      openConversations: countFor(input.conversationStatusGroups, "OPEN"),
      pendingConversations: countFor(
        input.conversationStatusGroups,
        "PENDING"
      ),
      resolvedConversations: countFor(
        input.conversationStatusGroups,
        "RESOLVED"
      ),
      totalTickets,
      openTickets: countFor(input.ticketStatusGroups, "OPEN"),
      resolvedClosedTickets,
      attachmentsCount: input.attachmentCount,
      teamCount: input.teamCount,
    },
    metrics: {
      firstResponseAvgMinutes: round2(input.firstResponseAvgMinutes),
      resolutionAvgMinutes: round2(input.resolutionAvgMinutes),
      firstResponseSampleSize: input.firstResponseCount,
      resolutionSampleSize: input.resolutionCount,
    },
    sla: {
      onTrack: countFor(input.slaGroups, "ON_TRACK"),
      atRisk: countFor(input.slaGroups, "AT_RISK"),
      breached: breachedTickets,
      paused: countFor(input.slaGroups, "PAUSED"),
      complianceRatePct: slaComplianceRatePct,
    },
    conversationsByChannel: mapBreakdown(input.conversationChannelGroups),
    conversationsByStatus: mapBreakdown(input.conversationStatusGroups),
    ticketsByStatus: mapBreakdown(input.ticketStatusGroups),
    ticketsByPriority: mapBreakdown(input.ticketPriorityGroups),
    ticketsByTeam: mapTeamCounts(input.ticketTeamGroups, input.teams),
    conversationsByTeam: mapTeamCounts(
      input.conversationTeamGroups,
      input.teams
    ),
    agentPerformance: input.agentPerformance,
    trends: input.trends,
    comparison: {
      previousPeriod: input.comparison.previous,
      deltas,
    },
    recentActivity: mapRecentActivity(input.recentActivity),
  };
};
