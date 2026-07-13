import { z } from "zod";
import { MessageSender } from "@prisma/client";

// ===== Create Message Validation =====
export const createMessageSchema = z.object({
  conversationId: z
    .string()
    .min(1, "Conversation ID is required"),

  sender: z.enum(MessageSender),

  content: z
    .string()
    .min(1, "Message content is required")
    .max(5000, "Message is too long"),

  metadata: z
    .record(z.string(), z.unknown())
    .optional(),
});

export type CreateMessageInput = z.infer<
  typeof createMessageSchema
>;