import { z } from "zod";
import { TicketPriority, TicketStatus } from "@prisma/client";

const nullableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .nullable()
  .optional();

export const ticketListQuerySchema = z.object({
  status: z.enum(TicketStatus).optional(),
  priority: z.enum(TicketPriority).optional(),
  assigneeId: z.string().trim().min(1).max(128).optional(),
  teamId: z.string().trim().min(1).max(128).optional(),
  tagId: z.string().trim().min(1).max(128).optional(),
  search: z.string().trim().max(200).optional(),
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().positive().max(100).default(30),
});

export const createTicketSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, "Subject is required")
    .max(200, "Subject is too long"),
  description: z
    .string()
    .trim()
    .max(5000, "Description is too long")
    .optional(),
  priority: z.enum(TicketPriority).default(TicketPriority.MEDIUM),
  status: z.enum(TicketStatus).default(TicketStatus.OPEN),
  customerId: nullableIdSchema,
  conversationId: nullableIdSchema,
  assigneeId: nullableIdSchema,
});

export const createConversationTicketSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, "Subject is required")
    .max(200, "Subject is too long"),
  description: z
    .string()
    .trim()
    .max(5000, "Description is too long")
    .optional(),
  priority: z.enum(TicketPriority).default(TicketPriority.MEDIUM),
  assigneeId: nullableIdSchema,
});

export const updateTicketSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, "Subject is required")
    .max(200, "Subject is too long")
    .optional(),
  description: z
    .string()
    .trim()
    .max(5000, "Description is too long")
    .nullable()
    .optional(),
  status: z.enum(TicketStatus).optional(),
  priority: z.enum(TicketPriority).optional(),
  assigneeId: nullableIdSchema,
});

export const createTicketNoteSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Note content is required")
    .max(5000, "Note is too long"),
});

export type TicketListQueryInput = z.infer<
  typeof ticketListQuerySchema
>;

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export type CreateConversationTicketInput = z.infer<
  typeof createConversationTicketSchema
>;

export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export type CreateTicketNoteInput = z.infer<
  typeof createTicketNoteSchema
>;
