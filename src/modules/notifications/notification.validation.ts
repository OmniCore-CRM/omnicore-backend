import { z } from "zod";

export const notificationListQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().positive().max(100).default(30),
});

export type NotificationListQueryInput = z.infer<
  typeof notificationListQuerySchema
>;
