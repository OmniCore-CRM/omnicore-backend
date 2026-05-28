import { z } from "zod";
import { ConversationChannel } from "@prisma/client";

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