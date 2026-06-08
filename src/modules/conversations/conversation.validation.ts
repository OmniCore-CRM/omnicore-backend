import { z } from "zod";
import { ConversationChannel, ConversationStatus } from "@prisma/client";

export const conversationListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  channel: z.enum(ConversationChannel).optional(),
  status: z.enum(ConversationStatus).optional(),
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
  status: z.enum(ConversationStatus),
});

export type UpdateConversationInput = z.infer<
  typeof updateConversationSchema
>;
