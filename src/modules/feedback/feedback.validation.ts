import { z } from "zod";
import {
  ConversationChannel,
  FeedbackEscalationStatus,
  FeedbackSurveyStatus,
  FeedbackSurveyType,
  FeedbackTriggerMode,
  FeedbackTriggerSource,
} from "@prisma/client";

export const feedbackOverviewQuerySchema = z
  .object({
    range: z.enum(["7d", "30d", "90d", "all"]).optional().default("30d"),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    teamId: z.string().trim().min(1).max(128).optional(),
    channel: z.enum(ConversationChannel).optional(),
    assigneeId: z.string().trim().min(1).max(128).optional(),
  })
  .superRefine((value, ctx) => {
    const hasStart = Boolean(value.startDate);
    const hasEnd = Boolean(value.endDate);

    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startDate and endDate must both be provided",
        path: hasStart ? ["endDate"] : ["startDate"],
      });
      return;
    }

    if (!hasStart || !hasEnd) return;

    const start = new Date(`${value.startDate}T00:00:00.000Z`);
    const end = new Date(`${value.endDate}T23:59:59.999Z`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid custom date range",
        path: ["startDate"],
      });
      return;
    }

    if (end.getTime() < start.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endDate must be on or after startDate",
        path: ["endDate"],
      });
    }
  });

export const feedbackDetractorsQuerySchema = z.object({
  status: z.enum(FeedbackEscalationStatus).optional(),
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const feedbackPendingSurveysQuerySchema = z.object({
  status: z
    .enum([FeedbackSurveyStatus.PENDING, FeedbackSurveyStatus.SENT, FeedbackSurveyStatus.EXPIRED])
    .optional(),
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const feedbackSurveyParamsSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

export const feedbackSurveyReissueSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const feedbackSurveyDeliverySchema = z.object({
  channel: z.enum([ConversationChannel.WHATSAPP, ConversationChannel.EMAIL]).optional(),
});

export const updateFeedbackEscalationSchema = z.object({
  status: z.enum(FeedbackEscalationStatus),
  assignedToId: z.string().trim().min(1).max(128).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export const feedbackPublicParamsSchema = z.object({
  token: z.string().trim().min(12).max(512),
});

export const submitFeedbackResponseSchema = z.object({
  score: z.coerce.number().int(),
  comment: z.string().trim().max(2000).optional(),
});

export const updateFeedbackTriggerConfigSchema = z.object({
  source: z.enum(FeedbackTriggerSource),
  mode: z.enum(FeedbackTriggerMode),
});

export const createFeedbackSurveyFromEventSchema = z.object({
  companyId: z.string().trim().min(1).max(128),
  triggerSource: z.enum(FeedbackTriggerSource),
  triggerEventKey: z.string().trim().min(1).max(191),
  customerId: z.string().trim().min(1).max(128),
  ticketId: z.string().trim().min(1).max(128).optional(),
  conversationId: z.string().trim().min(1).max(128).optional(),
  channel: z.enum(ConversationChannel).optional(),
  assigneeId: z.string().trim().min(1).max(128).optional(),
  actorId: z.string().trim().min(1).max(128).optional(),
  allowedTypes: z.array(z.enum(FeedbackSurveyType)).optional(),
});

export type FeedbackOverviewQueryInput = z.infer<
  typeof feedbackOverviewQuerySchema
>;

export type FeedbackDetractorsQueryInput = z.infer<
  typeof feedbackDetractorsQuerySchema
>;

export type FeedbackPendingSurveysQueryInput = z.infer<
  typeof feedbackPendingSurveysQuerySchema
>;

export type UpdateFeedbackEscalationInput = z.infer<
  typeof updateFeedbackEscalationSchema
>;

export type SubmitFeedbackResponseInput = z.infer<
  typeof submitFeedbackResponseSchema
>;

export type FeedbackSurveyReissueInput = z.infer<
  typeof feedbackSurveyReissueSchema
>;

export type FeedbackSurveyDeliveryInput = z.infer<
  typeof feedbackSurveyDeliverySchema
>;

export type UpdateFeedbackTriggerConfigInput = z.infer<
  typeof updateFeedbackTriggerConfigSchema
>;

export type CreateFeedbackSurveyFromEventInput = z.infer<
  typeof createFeedbackSurveyFromEventSchema
>;
