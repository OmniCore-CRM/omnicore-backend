import {
  ConversationStatus,
  NotificationType,
  Prisma,
  SlaStatus,
  TicketStatus,
  UserLifecycleStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import type { AssignmentCenterOverviewQueryInput } from "./assignment-center.validation.js";

type AssignmentCenterUserContext = {
  userId: string;
  companyId: string;
  role: string;
};

const activeConversationStatuses: ConversationStatus[] = [
  ConversationStatus.OPEN,
  ConversationStatus.PENDING,
  ConversationStatus.SNOOZED,
] ;

const openTicketStatuses: TicketStatus[] = [
  TicketStatus.OPEN,
  TicketStatus.PENDING,
  TicketStatus.ESCALATED,
] ;

const assignmentRelatedNotificationTypes: NotificationType[] = [
  NotificationType.TICKET_ASSIGNED,
  NotificationType.CONVERSATION_ASSIGNED,
  NotificationType.TICKET_TEAM_ASSIGNED,
  NotificationType.CONVERSATION_TEAM_ASSIGNED,
  NotificationType.TICKET_MENTION,
  NotificationType.CONVERSATION_MENTION,
] ;

const recentlyAssignedNotificationTypes: NotificationType[] = [
  NotificationType.TICKET_ASSIGNED,
  NotificationType.CONVERSATION_ASSIGNED,
  NotificationType.TICKET_TEAM_ASSIGNED,
  NotificationType.CONVERSATION_TEAM_ASSIGNED,
] ;

const teamVisibilityRoles = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.OWNER,
  UserRole.ADMIN,
  UserRole.TEAM_LEAD,
]);

const safeNotificationRoute = (metadata: unknown) => {
  if (!metadata || typeof metadata !== "object") return null;
  const route = (metadata as { route?: unknown }).route;
  return typeof route === "string" ? route : null;
};

const displayName = (user: { firstName: string; lastName: string; email: string }) =>
  [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

const asCountMap = <T extends { assigneeId: string | null; _count: { _all: number } }>(
  rows: T[],
) => {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!row.assigneeId) continue;
    map.set(row.assigneeId, row._count._all);
  }
  return map;
};

const asUserCountMap = <T extends { userId: string; _count: { _all: number } }>(rows: T[]) => {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.userId, row._count._all);
  }
  return map;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientPrismaConnectivityError = (error: unknown) => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

  return (
    error.code === "P1001" ||
    error.code === "P1002" ||
    error.message.includes("Can't reach database server")
  );
};

const withConnectivityRetry = async <T>(
  operation: () => Promise<T>,
  retries = 2,
): Promise<T> => {
  let attempt = 0;

  while (attempt <= retries) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientPrismaConnectivityError(error) || attempt === retries) {
        throw error;
      }

      attempt += 1;
      await sleep(200 * attempt);
    }
  }

  throw new Error("Unexpected retry state");
};

export class AssignmentCenterService {
  static async overview(
    user: AssignmentCenterUserContext,
    query: AssignmentCenterOverviewQueryInput,
  ) {
    const [
      myAssignedOpenTickets,
      myAssignedConversations,
      myUnreadAssignedWork,
      myPendingTickets,
      myPendingConversations,
      mySlaAtRisk,
      mySlaBreached,
      myEscalations,
      myRecentlyAssignedTotal,
      myTickets,
      myConversations,
      myRecentNotifications,
    ] = await withConnectivityRetry(() =>
      Promise.all([
        prisma.ticket.count({
        where: {
          companyId: user.companyId,
          assigneeId: user.userId,
          status: { in: openTicketStatuses },
        },
        }),
        prisma.conversation.count({
        where: {
          companyId: user.companyId,
          assigneeId: user.userId,
          status: { in: activeConversationStatuses },
        },
        }),
        prisma.notification.count({
        where: {
          companyId: user.companyId,
          userId: user.userId,
          isRead: false,
          type: {
            in: assignmentRelatedNotificationTypes,
          },
        },
        }),
        prisma.ticket.count({
        where: {
          companyId: user.companyId,
          assigneeId: user.userId,
          status: TicketStatus.PENDING,
        },
        }),
        prisma.conversation.count({
        where: {
          companyId: user.companyId,
          assigneeId: user.userId,
          status: ConversationStatus.PENDING,
        },
        }),
        prisma.ticket.count({
        where: {
          companyId: user.companyId,
          assigneeId: user.userId,
          status: { in: openTicketStatuses },
          slaStatus: SlaStatus.AT_RISK,
        },
        }),
        prisma.ticket.count({
        where: {
          companyId: user.companyId,
          assigneeId: user.userId,
          status: { in: openTicketStatuses },
          slaStatus: SlaStatus.BREACHED,
        },
        }),
        prisma.ticket.count({
        where: {
          companyId: user.companyId,
          assigneeId: user.userId,
          status: TicketStatus.ESCALATED,
        },
        }),
        prisma.notification.count({
        where: {
          companyId: user.companyId,
          userId: user.userId,
          type: { in: recentlyAssignedNotificationTypes },
        },
        }),
        prisma.ticket.findMany({
        where: {
          companyId: user.companyId,
          assigneeId: user.userId,
          status: { in: openTicketStatuses },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: query.listLimit,
        select: {
          id: true,
          subject: true,
          status: true,
          priority: true,
          slaStatus: true,
          updatedAt: true,
          team: {
            select: {
              id: true,
              name: true,
            },
          },
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        }),
        prisma.conversation.findMany({
        where: {
          companyId: user.companyId,
          assigneeId: user.userId,
          status: { in: activeConversationStatuses },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: query.listLimit,
        select: {
          id: true,
          channel: true,
          status: true,
          updatedAt: true,
          team: {
            select: {
              id: true,
              name: true,
            },
          },
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          messages: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              id: true,
              content: true,
              sender: true,
              createdAt: true,
            },
          },
        },
        }),
        prisma.notification.findMany({
        where: {
          companyId: user.companyId,
          userId: user.userId,
          type: { in: recentlyAssignedNotificationTypes },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.recentLimit,
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          entityType: true,
          entityId: true,
          isRead: true,
          metadata: true,
          createdAt: true,
        },
        }),
      ]),
    );

    const canViewTeamWorkload = teamVisibilityRoles.has(user.role as UserRole);

    const teamWorkload = canViewTeamWorkload
      ? await withConnectivityRetry(() => this.buildTeamWorkload(user.companyId))
      : null;

    return {
      scope: {
        canViewTeamWorkload,
      },
      counters: {
        myAssignedOpenTickets,
        myAssignedConversations,
        unreadAssignedWork: myUnreadAssignedWork,
        pendingAssignedWork: myPendingTickets + myPendingConversations,
        slaAtRisk: mySlaAtRisk,
        slaBreached: mySlaBreached,
        escalations: myEscalations,
        recentlyAssigned: myRecentlyAssignedTotal,
      },
      myTickets: myTickets.map((ticket) => ({
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        slaStatus: ticket.slaStatus,
        updatedAt: ticket.updatedAt,
        openRoute: `/tickets?ticketId=${ticket.id}`,
        team: ticket.team,
        customer: ticket.customer,
      })),
      myConversations: myConversations.map((conversation) => ({
        id: conversation.id,
        channel: conversation.channel,
        status: conversation.status,
        updatedAt: conversation.updatedAt,
        openRoute: `/inbox?c=${conversation.id}`,
        team: conversation.team,
        customer: conversation.customer,
        latestMessage: conversation.messages[0]
          ? {
              id: conversation.messages[0].id,
              content: conversation.messages[0].content,
              sender: conversation.messages[0].sender,
              createdAt: conversation.messages[0].createdAt,
            }
          : null,
      })),
      recentAssignments: myRecentNotifications.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        message: item.message,
        entityType: item.entityType,
        entityId: item.entityId,
        isRead: item.isRead,
        createdAt: item.createdAt,
        openRoute:
          safeNotificationRoute(item.metadata) ||
          (item.entityType === "TICKET"
            ? `/tickets?ticketId=${item.entityId}`
            : item.entityType === "CONVERSATION"
              ? `/inbox?c=${item.entityId}`
              : null),
      })),
      teamWorkload,
    };
  }

  private static async buildTeamWorkload(companyId: string) {
    const users = await prisma.user.findMany({
      where: {
        companyId,
        isActive: true,
        status: UserLifecycleStatus.ACTIVE,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        teamMemberships: {
          select: {
            team: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { email: "asc" }],
    });

    if (users.length === 0) return [];

    const userIds = users.map((item) => item.id);

    const [
      openTickets,
      pendingTickets,
      escalatedTickets,
      ticketsAtRisk,
      ticketsBreached,
      activeConversations,
      pendingConversations,
      unreadAssignedNotifications,
    ] = await Promise.all([
      prisma.ticket.groupBy({
        by: ["assigneeId"],
        where: {
          companyId,
          assigneeId: { in: userIds },
          status: { in: openTicketStatuses },
        },
        _count: { _all: true },
      }),
      prisma.ticket.groupBy({
        by: ["assigneeId"],
        where: {
          companyId,
          assigneeId: { in: userIds },
          status: TicketStatus.PENDING,
        },
        _count: { _all: true },
      }),
      prisma.ticket.groupBy({
        by: ["assigneeId"],
        where: {
          companyId,
          assigneeId: { in: userIds },
          status: TicketStatus.ESCALATED,
        },
        _count: { _all: true },
      }),
      prisma.ticket.groupBy({
        by: ["assigneeId"],
        where: {
          companyId,
          assigneeId: { in: userIds },
          status: { in: openTicketStatuses },
          slaStatus: SlaStatus.AT_RISK,
        },
        _count: { _all: true },
      }),
      prisma.ticket.groupBy({
        by: ["assigneeId"],
        where: {
          companyId,
          assigneeId: { in: userIds },
          status: { in: openTicketStatuses },
          slaStatus: SlaStatus.BREACHED,
        },
        _count: { _all: true },
      }),
      prisma.conversation.groupBy({
        by: ["assigneeId"],
        where: {
          companyId,
          assigneeId: { in: userIds },
          status: { in: activeConversationStatuses },
        },
        _count: { _all: true },
      }),
      prisma.conversation.groupBy({
        by: ["assigneeId"],
        where: {
          companyId,
          assigneeId: { in: userIds },
          status: ConversationStatus.PENDING,
        },
        _count: { _all: true },
      }),
      prisma.notification.groupBy({
        by: ["userId"],
        where: {
          companyId,
          userId: { in: userIds },
          isRead: false,
          type: {
            in: assignmentRelatedNotificationTypes,
          },
        },
        _count: { _all: true },
      }),
    ]);

    const openTicketCountByUser = asCountMap(openTickets);
    const pendingTicketCountByUser = asCountMap(pendingTickets);
    const escalatedTicketCountByUser = asCountMap(escalatedTickets);
    const atRiskCountByUser = asCountMap(ticketsAtRisk);
    const breachedCountByUser = asCountMap(ticketsBreached);
    const activeConversationCountByUser = asCountMap(activeConversations);
    const pendingConversationCountByUser = asCountMap(pendingConversations);
    const unreadByUser = asUserCountMap(unreadAssignedNotifications);

    return users
      .map((item) => {
        const assignedOpenTickets = openTicketCountByUser.get(item.id) ?? 0;
        const assignedConversations = activeConversationCountByUser.get(item.id) ?? 0;
        const pendingAssignedWork =
          (pendingTicketCountByUser.get(item.id) ?? 0) +
          (pendingConversationCountByUser.get(item.id) ?? 0);

        return {
          user: {
            id: item.id,
            role: item.role,
            displayName: displayName(item),
            email: item.email,
            teams: item.teamMemberships.map((membership) => membership.team),
          },
          counts: {
            assignedOpenTickets,
            assignedConversations,
            pendingAssignedWork,
            unreadAssignedWork: unreadByUser.get(item.id) ?? 0,
            escalations: escalatedTicketCountByUser.get(item.id) ?? 0,
            slaAtRisk: atRiskCountByUser.get(item.id) ?? 0,
            slaBreached: breachedCountByUser.get(item.id) ?? 0,
          },
        };
      })
      .sort((a, b) => {
        const aTotal =
          a.counts.assignedOpenTickets +
          a.counts.assignedConversations +
          a.counts.pendingAssignedWork;
        const bTotal =
          b.counts.assignedOpenTickets +
          b.counts.assignedConversations +
          b.counts.pendingAssignedWork;
        return bTotal - aTotal;
      });
  }
}
