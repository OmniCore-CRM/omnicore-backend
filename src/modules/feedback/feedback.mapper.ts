import type {
  FeedbackEscalation,
  FeedbackResponse,
  FeedbackSurvey,
  FeedbackTriggerConfig,
} from "@prisma/client";

export const mapFeedbackTriggerConfig = (config: FeedbackTriggerConfig) => ({
  id: config.id,
  source: config.source,
  mode: config.mode,
  createdAt: config.createdAt,
  updatedAt: config.updatedAt,
});

export const mapFeedbackSurvey = (survey: FeedbackSurvey) => ({
  id: survey.id,
  type: survey.type,
  status: survey.status,
  triggerSource: survey.triggerSource,
  triggerEventKey: survey.triggerEventKey,
  expiresAt: survey.expiresAt,
  sentAt: survey.sentAt,
  completedAt: survey.completedAt,
  ticketId: survey.ticketId,
  conversationId: survey.conversationId,
  customerId: survey.customerId,
  channel: survey.channel,
  assigneeId: survey.assigneeId,
  createdAt: survey.createdAt,
});

export const mapFeedbackResponse = (response: FeedbackResponse) => ({
  id: response.id,
  surveyId: response.surveyId,
  type: response.type,
  score: response.score,
  comment: response.comment,
  sentiment: response.sentiment,
  submittedAt: response.submittedAt,
  ticketId: response.ticketId,
  conversationId: response.conversationId,
  customerId: response.customerId,
  channel: response.channel,
  assigneeId: response.assigneeId,
});

export const mapFeedbackEscalation = (
  escalation: FeedbackEscalation & {
    response: FeedbackResponse;
    survey: FeedbackSurvey;
    assignedTo: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      role: string;
    } | null;
    customer: {
      id: string;
      firstName: string;
      lastName: string | null;
      email: string | null;
    };
  }
) => ({
  id: escalation.id,
  status: escalation.status,
  reason: escalation.reason,
  resolvedAt: escalation.resolvedAt,
  createdAt: escalation.createdAt,
  updatedAt: escalation.updatedAt,
  assignedTo: escalation.assignedTo,
  survey: mapFeedbackSurvey(escalation.survey),
  response: mapFeedbackResponse(escalation.response),
  customer: escalation.customer,
});
