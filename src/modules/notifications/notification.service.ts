import {
  NotificationType,
  UserLifecycleStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { toPaginatedResult } from "@/core/utils/pagination.js";
import { getIO } from "@/socket/socket.server.js";
import { mapNotification, mapNotifications } from "./notification.mapper.js";
import type { NotificationListQueryInput } from "./notification.validation.js";

type MentionContext = {
  companyId: string;
  actorId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
};

type TeamAssignmentContext = {
  companyId: string;
  actorId: string;
  teamId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
};

export class NotificationService {
  static async listNotifications(
    companyId: string,
    userId: string,
    query: NotificationListQueryInput,
  ) {
    const notifications = await prisma.notification.findMany({
      where: {
        companyId,
        userId,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor
        ? {
            cursor: {
              id: query.cursor,
            },
            skip: 1,
          }
        : {}),
    });

    const page = toPaginatedResult(notifications, query.limit);

    return {
      ...page,
      items: mapNotifications(page.items),
    };
  }

  static async unreadCount(companyId: string, userId: string) {
    const unread = await prisma.notification.count({
      where: {
        companyId,
        userId,
        isRead: false,
      },
    });

    return { unread };
  }

  static async markRead(companyId: string, userId: string, id: string) {
    const existing = await prisma.notification.findFirst({
      where: {
        id,
        companyId,
        userId,
      },
    });

    if (!existing) {
      throw new AppError("Notification not found", HTTP_STATUS.NOT_FOUND);
    }

    if (existing.isRead) {
      const unreadCount = await this.unreadCountValue(companyId, userId);
      this.emitNotificationUpdated(userId, {
        notificationId: existing.id,
        isRead: true,
        unreadCount,
      });
      return mapNotification(existing);
    }

    const updated = await prisma.notification.update({
      where: {
        id: existing.id,
      },
      data: {
        isRead: true,
      },
    });

    const unreadCount = await this.unreadCountValue(companyId, userId);
    this.emitNotificationUpdated(userId, {
      notificationId: updated.id,
      isRead: true,
      unreadCount,
    });

    return mapNotification(updated);
  }

  static async markUnread(companyId: string, userId: string, id: string) {
    const existing = await prisma.notification.findFirst({
      where: {
        id,
        companyId,
        userId,
      },
    });

    if (!existing) {
      throw new AppError("Notification not found", HTTP_STATUS.NOT_FOUND);
    }

    if (!existing.isRead) {
      const unreadCount = await this.unreadCountValue(companyId, userId);
      this.emitNotificationUpdated(userId, {
        notificationId: existing.id,
        isRead: false,
        unreadCount,
      });
      return mapNotification(existing);
    }

    const updated = await prisma.notification.update({
      where: {
        id: existing.id,
      },
      data: {
        isRead: false,
      },
    });

    const unreadCount = await this.unreadCountValue(companyId, userId);
    this.emitNotificationUpdated(userId, {
      notificationId: updated.id,
      isRead: false,
      unreadCount,
    });

    return mapNotification(updated);
  }

  static async markAllRead(companyId: string, userId: string) {
    await prisma.notification.updateMany({
      where: {
        companyId,
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    this.emitNotificationReadAll(userId, { unreadCount: 0 });

    return { success: true };
  }

  static async createNotification(input: {
    companyId: string;
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
    dedupeWindowMinutes?: number;
  }) {
    const dedupeWindowMinutes = input.dedupeWindowMinutes ?? 2;
    const dedupeThreshold = new Date(Date.now() - dedupeWindowMinutes * 60_000);

    const duplicate = await prisma.notification.findFirst({
      where: {
        companyId: input.companyId,
        userId: input.userId,
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        title: input.title,
        message: input.message,
        createdAt: {
          gte: dedupeThreshold,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (duplicate) {
      return mapNotification(duplicate);
    }

    const created = await prisma.notification.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata,
      },
    });

    const unreadCount = await this.unreadCountValue(input.companyId, input.userId);
    this.emitNotificationNew(input.userId, {
      notification: mapNotification(created),
      unreadCount,
    });

    return mapNotification(created);
  }

  static async notifyTicketAssigned(input: {
    companyId: string;
    actorId: string;
    assigneeId: string;
    ticketId: string;
    ticketSubject: string;
  }) {
    if (input.assigneeId === input.actorId) return;

    await this.createNotification({
      companyId: input.companyId,
      userId: input.assigneeId,
      type: NotificationType.TICKET_ASSIGNED,
      title: "Ticket assigned to you",
      message: `Ticket ${input.ticketSubject} was assigned to you.`,
      entityType: "TICKET",
      entityId: input.ticketId,
      metadata: {
        route: `/tickets?ticketId=${input.ticketId}`,
      },
    });
  }

  static async notifyConversationAssigned(input: {
    companyId: string;
    actorId: string;
    assigneeId: string;
    conversationId: string;
    customerLabel: string;
  }) {
    if (input.assigneeId === input.actorId) return;

    await this.createNotification({
      companyId: input.companyId,
      userId: input.assigneeId,
      type: NotificationType.CONVERSATION_ASSIGNED,
      title: "Conversation assigned to you",
      message: `Conversation with ${input.customerLabel} was assigned to you.`,
      entityType: "CONVERSATION",
      entityId: input.conversationId,
      metadata: {
        route: `/inbox?c=${input.conversationId}`,
      },
    });
  }

  static async notifyTeamAssignment(input: TeamAssignmentContext) {
    const members = await prisma.teamMember.findMany({
      where: {
        companyId: input.companyId,
        teamId: input.teamId,
      },
      select: {
        userId: true,
      },
    });

    const userIds = Array.from(
      new Set(
        members
          .map((member) => member.userId)
          .filter((id) => id && id !== input.actorId),
      ),
    );

    await Promise.all(
      userIds.map((userId) =>
        this.createNotification({
          companyId: input.companyId,
          userId,
          type: input.type,
          title: input.title,
          message: input.message,
          entityType: input.entityType,
          entityId: input.entityId,
          metadata: input.metadata,
        }),
      ),
    );
  }

  static async notifyMentionsFromText(
    content: string,
    context: MentionContext,
  ) {
    const handles = this.extractMentionHandles(content);
    if (handles.length === 0) return;

    const users = await prisma.user.findMany({
      where: {
        companyId: context.companyId,
        isActive: true,
        status: UserLifecycleStatus.ACTIVE,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });

    const userIdByHandle = new Map<string, string>();

    for (const user of users) {
      const emailPrefix = user.email.split("@")[0]?.toLowerCase();
      const firstName = user.firstName.toLowerCase();
      const lastName = user.lastName.toLowerCase();

      if (emailPrefix) userIdByHandle.set(emailPrefix, user.id);
      userIdByHandle.set(firstName, user.id);
      userIdByHandle.set(lastName, user.id);
    }

    const targetUserIds = Array.from(
      new Set(
        handles
          .map((handle) => userIdByHandle.get(handle.toLowerCase()) ?? null)
          .filter((userId): userId is string => Boolean(userId && userId !== context.actorId)),
      ),
    );

    await Promise.all(
      targetUserIds.map((userId) =>
        this.createNotification({
          companyId: context.companyId,
          userId,
          type: context.type,
          title: context.title,
          message: context.message,
          entityType: context.entityType,
          entityId: context.entityId,
          metadata: context.metadata,
        }),
      ),
    );
  }

  static async notifySystemEvent(input: {
    companyId: string;
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    await this.createNotification({
      companyId: input.companyId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
    });
  }

  private static extractMentionHandles(content: string) {
    const pattern = /(^|\s)@([a-zA-Z0-9._-]{2,64})/g;
    const handles = new Set<string>();

    for (const match of content.matchAll(pattern)) {
      const handle = match[2]?.trim().toLowerCase();
      if (handle) handles.add(handle);
    }

    return Array.from(handles);
  }

  private static async unreadCountValue(companyId: string, userId: string) {
    return prisma.notification.count({
      where: {
        companyId,
        userId,
        isRead: false,
      },
    });
  }

  private static emitNotificationNew(
    userId: string,
    payload: {
      notification: ReturnType<typeof mapNotification>;
      unreadCount: number;
    },
  ) {
    try {
      getIO().to(`user:${userId}`).emit("notification:new", payload);
    } catch {
      // Ignore socket emit failures for request path continuity.
    }
  }

  private static emitNotificationUpdated(
    userId: string,
    payload: {
      notificationId: string;
      isRead: boolean;
      unreadCount: number;
    },
  ) {
    try {
      getIO().to(`user:${userId}`).emit("notification:updated", payload);
    } catch {
      // Ignore socket emit failures for request path continuity.
    }
  }

  private static emitNotificationReadAll(
    userId: string,
    payload: {
      unreadCount: number;
    },
  ) {
    try {
      getIO().to(`user:${userId}`).emit("notification:read-all", payload);
    } catch {
      // Ignore socket emit failures for request path continuity.
    }
  }
}
