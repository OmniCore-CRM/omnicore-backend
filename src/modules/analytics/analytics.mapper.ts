import type {
  AuditLog,
  ConversationChannel,
  ConversationStatus,
  TicketPriority,
  TicketStatus,
  User,
} from "@prisma/client";
import type { AnalyticsRange } from "./analytics.validation.js";

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

type RecentAuditLog = AuditLog & {
  actor: User | null;
};

type AnalyticsOverviewInput = {
  range: AnalyticsRange;
  from: Date | null;
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

export const mapAnalyticsOverview = (input: AnalyticsOverviewInput) => {
  const totalConversations = input.conversationStatusGroups.reduce(
    (total, group) => total + group.count,
    0
  );
  const totalTickets = input.ticketStatusGroups.reduce(
    (total, group) => total + group.count,
    0
  );

  return {
    range: input.range,
    period: {
      from: input.from,
      to: new Date(),
    },
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
      resolvedClosedTickets:
        countFor(input.ticketStatusGroups, "RESOLVED") +
        countFor(input.ticketStatusGroups, "CLOSED"),
      attachmentsCount: input.attachmentCount,
      teamCount: input.teamCount,
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
    recentActivity: mapRecentActivity(input.recentActivity),
  };
};
