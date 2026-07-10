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
  // Phase 1: landing page customisation
  companyDisplayName: z.string().trim().max(120, "Company name is too long").optional(),
  welcomeTitle: z.string().trim().max(200, "Welcome title is too long").optional(),
  welcomeSubtitle: z.string().trim().max(400, "Welcome subtitle is too long").optional(),
  chatGreeting: z.string().trim().max(200, "Chat greeting is too long").optional(),
  launcherLabel: z.string().trim().max(60, "Launcher label is too long").optional(),
  footerNote: z.string().trim().max(400, "Footer note is too long").optional(),
  messageShortcuts: z
    .array(z.string().trim().min(1).max(120))
    .max(6, "Too many shortcuts")
    .optional(),
  // Phase 3: branding
  brandColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Brand color must be a valid HEX color (#RRGGBB)")
    .optional()
    .nullable(),
  logoUrl: z.string().url("Must be a valid URL").max(2048).optional().nullable(),
  heroImageUrl: z.string().url("Must be a valid URL").max(2048).optional().nullable(),
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
    .max(2000, "Message is too long"),
});

// ===== Send widget message =====
export const createWidgetMessageSchema = z.object({
  publicKey: publicKeySchema,

  sessionToken: sessionTokenSchema,

  content: z
    .string()
    .trim()
    .min(1, "Message content is required")
    .max(2000, "Message is too long"),
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

// ===== FAQ management (admin) =====
export const createWidgetFaqEntrySchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "Question is required")
    .max(300, "Question is too long"),
  answer: z
    .string()
    .trim()
    .min(1, "Answer is required")
    .max(1000, "Answer is too long"),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const updateWidgetFaqEntrySchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "Question is required")
    .max(300, "Question is too long")
    .optional(),
  answer: z
    .string()
    .trim()
    .min(1, "Answer is required")
    .max(1000, "Answer is too long")
    .optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export type CreateWidgetFaqEntryInput = z.infer<
  typeof createWidgetFaqEntrySchema
>;

export type UpdateWidgetFaqEntryInput = z.infer<
  typeof updateWidgetFaqEntrySchema
>;
