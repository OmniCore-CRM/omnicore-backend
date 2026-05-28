import { z } from "zod";

// ===== Create widget conversation =====
export const createWidgetConversationSchema = z.object({
  firstName: z
    .string()
    .min(1, "First name is required"),

  lastName: z
    .string()
    .min(1, "Last name is required"),

  email: z.email("Invalid email address"),

  initialMessage: z
    .string()
    .min(1, "Initial message is required")
    .max(5000, "Message is too long"),
});

// ===== Send widget message =====
export const createWidgetMessageSchema = z.object({
  conversationId: z
    .string()
    .min(1, "Conversation ID is required"),

  content: z
    .string()
    .min(1, "Message content is required")
    .max(5000, "Message is too long"),
});

export type CreateWidgetConversationInput = z.infer<
  typeof createWidgetConversationSchema
>;

export type CreateWidgetMessageInput = z.infer<
  typeof createWidgetMessageSchema
>;