import { z } from "zod";
import {
  ConversationChannel,
  ConversationStatus,
  TicketPriority,
  TicketStatus,
} from "@prisma/client";

export const conversationListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  channel: z.enum(ConversationChannel).optional(),
  status: z.enum(ConversationStatus).optional(),
  ticketStatus: z.enum(TicketStatus).optional(),
  ticketPriority: z.enum(TicketPriority).optional(),
  assigneeId: z.string().trim().min(1).max(128).optional(),
  teamId: z.string().trim().min(1).max(128).optional(),
  tagId: z.string().trim().min(1).max(128).optional(),
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().positive().max(100).default(30),
});

export type ConversationListQueryInput = z.infer<
  typeof conversationListQuerySchema
>;

// ===== Create Conversation Validation =====
export const createConversationSchema = z.object({
  customerId: z
    .string()
    .min(1, "Customer ID is required"),

  channel: z.enum(ConversationChannel),
});

export type CreateConversationInput = z.infer<
  typeof createConversationSchema
>;

export const updateConversationSchema = z.object({
  status: z.enum(ConversationStatus).optional(),
  assigneeId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .nullable()
    .optional(),
}).refine(
  (value) => value.status !== undefined || value.assigneeId !== undefined,
  {
    message: "At least one update field is required",
  }
);

export type UpdateConversationInput = z.infer<
  typeof updateConversationSchema
>;
