import { z } from "zod";

export const auditLogListQuerySchema = z.object({
  action: z.string().trim().min(1).max(100).optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  actorId: z.string().trim().min(1).max(128).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().positive().max(100).default(30),
});

export type AuditLogListQueryInput = z.infer<
  typeof auditLogListQuerySchema
>;
