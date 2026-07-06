import type { Notification } from "@prisma/client";

export const mapNotification = (
  notification: Notification,
) => ({
  id: notification.id,
  type: notification.type,
  title: notification.title,
  message: notification.message,
  body: notification.message,
  entityType: notification.entityType,
  entityId: notification.entityId,
  metadata: notification.metadata,
  isRead: notification.isRead,
  read: notification.isRead,
  createdAt: notification.createdAt,
});

export const mapNotifications = (notifications: Notification[]) =>
  notifications.map(mapNotification);
