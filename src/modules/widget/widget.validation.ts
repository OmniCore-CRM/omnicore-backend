import { z } from "zod";

const publicKeySchema = z
  .string()
  .trim()
  .min(1, "Widget key is required")
  .max(128, "Widget key is too long");

const sessionTokenSchema = z
  .string()
  .trim()
  .min(1, "Widget session token is required")
  .max(2048, "Widget session token is too long");

const domainSchema = z
  .string()
  .trim()
  .min(1, "Domain is required")
  .max(255, "Domain is too long");

// ===== Admin widget installation =====
export const createWidgetInstallationSchema = z.object({
  allowedDomains: z
    .array(domainSchema)
    .max(25, "Too many allowed domains")
    .default([]),
});

export const updateWidgetInstallationSchema = z.object({
  enabled: z.boolean().optional(),
  allowedDomains: z
    .array(domainSchema)
    .max(25, "Too many allowed domains")
    .optional(),
});

// ===== Create widget conversation =====
export const createWidgetConversationSchema = z.object({
  publicKey: publicKeySchema,

  visitorName: z
    .string()
    .trim()
    .min(1, "Visitor name is required")
    .max(120, "Visitor name is too long"),

  visitorEmail: z
    .string()
    .trim()
    .email("Invalid email address")
    .max(255, "Email is too long")
    .optional(),

  initialMessage: z
    .string()
    .trim()
    .min(1, "Initial message is required")
    .max(5000, "Message is too long"),
});

// ===== Send widget message =====
export const createWidgetMessageSchema = z.object({
  publicKey: publicKeySchema,

  sessionToken: sessionTokenSchema,

  content: z
    .string()
    .trim()
    .min(1, "Message content is required")
    .max(5000, "Message is too long"),
});

export const widgetBootstrapQuerySchema = z.object({
  key: publicKeySchema,
});

export const widgetMessagesQuerySchema = z.object({
  key: publicKeySchema,
  sessionToken: sessionTokenSchema,
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().positive().max(100).default(30),
});

export type CreateWidgetInstallationInput = z.infer<
  typeof createWidgetInstallationSchema
>;

export type UpdateWidgetInstallationInput = z.infer<
  typeof updateWidgetInstallationSchema
>;

export type CreateWidgetConversationInput = z.infer<
  typeof createWidgetConversationSchema
>;

export type CreateWidgetMessageInput = z.infer<
  typeof createWidgetMessageSchema
>;

export type WidgetMessagesQueryInput = z.infer<
  typeof widgetMessagesQuerySchema
>;
