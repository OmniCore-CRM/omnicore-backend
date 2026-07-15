import crypto from "node:crypto";
import {
  ConversationChannel,
  FeedbackEscalationStatus,
  FeedbackSentiment,
  FeedbackSurveyStatus,
  FeedbackSurveyType,
  FeedbackTriggerMode,
  FeedbackTriggerSource,
  MessageStatus,
  NotificationType,
  Prisma,
  UserLifecycleStatus,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { env } from "@/config/env.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { toPaginatedResult } from "@/core/utils/pagination.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { ChannelService } from "@/modules/channels/channel.service.js";
import { MessageService } from "@/modules/messages/message.service.js";
import { NotificationService } from "@/modules/notifications/notification.service.js";
import {
  mapFeedbackEscalation,
  mapFeedbackSurvey,
  mapFeedbackTriggerConfig,
} from "./feedback.mapper.js";
import type {
  CreateFeedbackSurveyFromEventInput,
  FeedbackPendingSurveysQueryInput,
  FeedbackSurveyDeliveryInput,
  FeedbackSurveyReissueInput,
  FeedbackDetractorsQueryInput,
  FeedbackOverviewQueryInput,
  SubmitFeedbackResponseInput,
  UpdateFeedbackEscalationInput,
  UpdateFeedbackTriggerConfigInput,
} from "./feedback.validation.js";

const rangeDays = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
} as const;

const SURVEY_EXPIRY_DAYS = 14;
const SURVEY_LINK_HANDOFF_WINDOW_MS = 30 * 60 * 1000;

type SurveyLinkHandoff = {
  token: string;
  url: string;
  expiresAtMs: number;
};

const surveyLinkHandoff = new Map<string, SurveyLinkHandoff>();

const appWebBaseUrl = () => env.APP_ORIGINS[0] ?? "http://localhost:3000";

const handoffKey = (companyId: string, surveyId: string) => `${companyId}:${surveyId}`;

const cleanupHandoffLinks = () => {
  const now = Date.now();
  for (const [key, entry] of surveyLinkHandoff.entries()) {
    if (entry.expiresAtMs <= now) {
      surveyLinkHandoff.delete(key);
    }
  }
};

const storeHandoffLink = (input: {
  companyId: string;
  surveyId: string;
  token: string;
  surveyExpiresAt: Date;
}) => {
  cleanupHandoffLinks();
  const windowEnd = Date.now() + SURVEY_LINK_HANDOFF_WINDOW_MS;
  const expiresAtMs = Math.min(windowEnd, input.surveyExpiresAt.getTime());
  const url = FeedbackService.buildSurveyPublicUrl(appWebBaseUrl(), input.token);

  surveyLinkHandoff.set(handoffKey(input.companyId, input.surveyId), {
    token: input.token,
    url,
    expiresAtMs,
  });
};

const getHandoffLink = (companyId: string, surveyId: string) => {
  cleanupHandoffLinks();
  return surveyLinkHandoff.get(handoffKey(companyId, surveyId)) ?? null;
};

const defaultModeBySource: Record<FeedbackTriggerSource, FeedbackTriggerMode> = {
  [FeedbackTriggerSource.TICKET_RESOLVED]: FeedbackTriggerMode.CSAT,
  [FeedbackTriggerSource.CONVERSATION_RESOLVED]: FeedbackTriggerMode.CSAT,
};

const modeToTypes = (mode: FeedbackTriggerMode) => {
  if (mode === FeedbackTriggerMode.DISABLED) return [];
  if (mode === FeedbackTriggerMode.CSAT) return [FeedbackSurveyType.CSAT];
  if (mode === FeedbackTriggerMode.NPS) return [FeedbackSurveyType.NPS];
  return [FeedbackSurveyType.CSAT, FeedbackSurveyType.NPS];
};

const parseIsoDayStart = (value: string) => new Date(`${value}T00:00:00.000Z`);

const parseIsoDayEnd = (value: string) => new Date(`${value}T23:59:59.999Z`);

const getDateWindow = (query: FeedbackOverviewQueryInput) => {
  if (query.startDate && query.endDate) {
    return {
      from: parseIsoDayStart(query.startDate),
      to: parseIsoDayEnd(query.endDate),
      range: "custom" as const,
    };
  }

  const range = query.range;
  const to = new Date();
  if (range === "all") {
    return { from: null, to, range };
  }

  const from = new Date();
  from.setUTCDate(from.getUTCDate() - rangeDays[range]);
  return { from, to, range };
};

const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("base64url");

const generateSurveyToken = () => crypto.randomBytes(24).toString("base64url");

const sentimentForScore = (type: FeedbackSurveyType, score: number) => {
  if (type === FeedbackSurveyType.CSAT) {
    if (score <= 2) return FeedbackSentiment.DETRACTOR;
    if (score === 3) return FeedbackSentiment.NEUTRAL;
    return FeedbackSentiment.SATISFIED;
  }

  if (score <= 6) return FeedbackSentiment.DETRACTOR;
  if (score <= 8) return FeedbackSentiment.PASSIVE;
  return FeedbackSentiment.PROMOTER;
};

const assertScoreRange = (type: FeedbackSurveyType, score: number) => {
  if (type === FeedbackSurveyType.CSAT && (score < 1 || score > 5)) {
    throw new AppError("CSAT score must be between 1 and 5", HTTP_STATUS.BAD_REQUEST);
  }

  if (type === FeedbackSurveyType.NPS && (score < 0 || score > 10)) {
    throw new AppError("NPS score must be between 0 and 10", HTTP_STATUS.BAD_REQUEST);
  }
};

const uniqueBy = <T>(items: T[], key: (value: T) => string) => {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(item);
  }

  return out;
};

export class FeedbackService {
  static async getTriggerConfigs(companyId: string) {
    const existing = await prisma.feedbackTriggerConfig.findMany({
      where: { companyId },
      orderBy: { source: "asc" },
    });

    const bySource = new Map(existing.map((item) => [item.source, item]));

    const normalized = Object.values(FeedbackTriggerSource).map((source) => {
      const item = bySource.get(source);
      if (item) return mapFeedbackTriggerConfig(item);

      return {
        id: `default:${source}`,
        source,
        mode: defaultModeBySource[source],
        createdAt: null,
        updatedAt: null,
      };
    });

    return normalized;
  }

  static async upsertTriggerConfig(
    companyId: string,
    actorId: string,
    input: UpdateFeedbackTriggerConfigInput
  ) {
    const config = await prisma.feedbackTriggerConfig.upsert({
      where: {
        companyId_source: {
          companyId,
          source: input.source,
        },
      },
      create: {
        companyId,
        source: input.source,
        mode: input.mode,
      },
      update: {
        mode: input.mode,
      },
    });

    await AuditLogService.record({
      companyId,
      actorId,
      action: "FEEDBACK_TRIGGER_CONFIG_UPDATED",
      entityType: "FEEDBACK_TRIGGER_CONFIG",
      entityId: config.id,
      metadata: {
        source: input.source,
        mode: input.mode,
      },
    });

    return mapFeedbackTriggerConfig(config);
  }

  static async createSurveysFromEvent(input: CreateFeedbackSurveyFromEventInput) {
    const config = await prisma.feedbackTriggerConfig.findUnique({
      where: {
        companyId_source: {
          companyId: input.companyId,
          source: input.triggerSource,
        },
      },
    });

    const mode = config?.mode ?? defaultModeBySource[input.triggerSource];
    const triggerTypes = modeToTypes(mode);

    if (triggerTypes.length === 0) {
      return [];
    }

    const allowed = input.allowedTypes?.length
      ? new Set(input.allowedTypes)
      : null;

    const types = triggerTypes.filter((type) => (allowed ? allowed.has(type) : true));
    if (types.length === 0) return [];

    const created: Array<{ token: string; survey: Awaited<ReturnType<typeof prisma.feedbackSurvey.create>> }> = [];

    for (const type of types) {
      const existing = await prisma.feedbackSurvey.findFirst({
        where: {
          companyId: input.companyId,
          triggerSource: input.triggerSource,
          triggerEventKey: input.triggerEventKey,
          type,
        },
      });

      if (existing) continue;

      const token = generateSurveyToken();
      const tokenHash = hashToken(token);
      const now = new Date();
      const expiresAt = new Date(now);
      expiresAt.setUTCDate(expiresAt.getUTCDate() + SURVEY_EXPIRY_DAYS);

      const survey = await prisma.feedbackSurvey.create({
        data: {
          companyId: input.companyId,
          customerId: input.customerId,
          conversationId: input.conversationId,
          ticketId: input.ticketId,
          channel: input.channel,
          assigneeId: input.assigneeId,
          type,
          status: FeedbackSurveyStatus.SENT,
          triggerSource: input.triggerSource,
          triggerEventKey: input.triggerEventKey,
          tokenHash,
          expiresAt,
          sentAt: now,
        },
      });

      created.push({ token, survey });
      storeHandoffLink({
        companyId: input.companyId,
        surveyId: survey.id,
        token,
        surveyExpiresAt: survey.expiresAt,
      });

      await AuditLogService.record({
        companyId: input.companyId,
        actorId: input.actorId,
        action: "FEEDBACK_SURVEY_CREATED",
        entityType: "FEEDBACK_SURVEY",
        entityId: survey.id,
        metadata: {
          type: survey.type,
          triggerSource: survey.triggerSource,
          triggerEventKey: survey.triggerEventKey,
          ticketId: survey.ticketId,
          conversationId: survey.conversationId,
          customerId: survey.customerId,
          expiresAt: survey.expiresAt.toISOString(),
        },
      });
    }

    return created;
  }

  static async getPublicSurvey(token: string) {
    const tokenHash = hashToken(token);

    const survey = await prisma.feedbackSurvey.findUnique({
      where: { tokenHash },
      include: {
        company: {
          select: {
            id: true,
            name: true,
          },
        },
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        response: true,
      },
    });

    if (!survey) {
      throw new AppError("Survey not found", HTTP_STATUS.NOT_FOUND);
    }

    const now = new Date();
    const isExpired = survey.expiresAt.getTime() < now.getTime();

    if (isExpired && survey.status !== FeedbackSurveyStatus.EXPIRED && !survey.response) {
      await prisma.feedbackSurvey.update({
        where: { id: survey.id },
        data: { status: FeedbackSurveyStatus.EXPIRED },
      });
    }

    return {
      survey: {
        id: survey.id,
        type: survey.type,
        status: survey.response
          ? FeedbackSurveyStatus.COMPLETED
          : isExpired
            ? FeedbackSurveyStatus.EXPIRED
            : survey.status,
        expiresAt: survey.expiresAt,
        completedAt: survey.completedAt,
      },
      company: survey.company,
      customer: survey.customer,
      response: survey.response
        ? {
            score: survey.response.score,
            comment: survey.response.comment,
            sentiment: survey.response.sentiment,
            submittedAt: survey.response.submittedAt,
          }
        : null,
      scoring: survey.type === FeedbackSurveyType.CSAT
        ? {
            min: 1,
            max: 5,
            labels: {
              1: "Very dissatisfied",
              2: "Dissatisfied",
              3: "Neutral",
              4: "Satisfied",
              5: "Very satisfied",
            },
          }
        : {
            min: 0,
            max: 10,
            labels: {
              0: "Not likely",
              10: "Very likely",
            },
          },
    };
  }

  static async submitPublicSurvey(token: string, input: SubmitFeedbackResponseInput) {
    const tokenHash = hashToken(token);

    const payload = await prisma.$transaction(async (tx) => {
      const survey = await tx.feedbackSurvey.findUnique({
        where: { tokenHash },
        include: {
          response: true,
        },
      });

      if (!survey) {
        throw new AppError("Survey not found", HTTP_STATUS.NOT_FOUND);
      }

      if (survey.response || survey.status === FeedbackSurveyStatus.COMPLETED) {
        throw new AppError("Feedback already submitted", HTTP_STATUS.CONFLICT);
      }

      if (survey.expiresAt.getTime() < Date.now()) {
        if (survey.status !== FeedbackSurveyStatus.EXPIRED) {
          await tx.feedbackSurvey.update({
            where: { id: survey.id },
            data: { status: FeedbackSurveyStatus.EXPIRED },
          });
        }
        throw new AppError("Survey has expired", HTTP_STATUS.BAD_REQUEST);
      }

      assertScoreRange(survey.type, input.score);

      const sentiment = sentimentForScore(survey.type, input.score);
      const now = new Date();

      const response = await tx.feedbackResponse.create({
        data: {
          surveyId: survey.id,
          companyId: survey.companyId,
          customerId: survey.customerId,
          ticketId: survey.ticketId,
          conversationId: survey.conversationId,
          channel: survey.channel,
          assigneeId: survey.assigneeId,
          type: survey.type,
          score: input.score,
          comment: input.comment || null,
          sentiment,
          submittedAt: now,
        },
      });

      const updatedSurvey = await tx.feedbackSurvey.update({
        where: { id: survey.id },
        data: {
          status: FeedbackSurveyStatus.COMPLETED,
          completedAt: now,
        },
      });

      let escalation = null;

      if (sentiment === FeedbackSentiment.DETRACTOR) {
        escalation = await tx.feedbackEscalation.create({
          data: {
            companyId: survey.companyId,
            surveyId: survey.id,
            responseId: response.id,
            status: FeedbackEscalationStatus.OPEN,
            reason: survey.type === FeedbackSurveyType.CSAT
              ? "Low CSAT score"
              : "Low NPS score",
            assignedToId: survey.assigneeId,
          },
        });
      }

      return {
        survey: updatedSurvey,
        response,
        escalation,
      };
    });

    await AuditLogService.record({
      companyId: payload.response.companyId,
      actorId: null,
      action: "FEEDBACK_RESPONSE_SUBMITTED",
      entityType: "FEEDBACK_RESPONSE",
      entityId: payload.response.id,
      metadata: {
        surveyId: payload.survey.id,
        type: payload.response.type,
        score: payload.response.score,
        sentiment: payload.response.sentiment,
        ticketId: payload.response.ticketId,
        conversationId: payload.response.conversationId,
      },
    });

    if (payload.escalation) {
      await AuditLogService.record({
        companyId: payload.response.companyId,
        actorId: null,
        action: "FEEDBACK_DETRACTOR_ESCALATED",
        entityType: "FEEDBACK_ESCALATION",
        entityId: payload.escalation.id,
        metadata: {
          responseId: payload.response.id,
          surveyId: payload.survey.id,
          score: payload.response.score,
          type: payload.response.type,
          assignedToId: payload.escalation.assignedToId,
        },
      });

      if (payload.escalation.assignedToId) {
        await NotificationService.createNotification({
          companyId: payload.response.companyId,
          userId: payload.escalation.assignedToId,
          type: NotificationType.FEEDBACK_DETRACTOR_ESCALATION,
          title: "Detractor feedback needs review",
          message: `A ${payload.response.type} response was submitted with score ${payload.response.score}.`,
          entityType: "FEEDBACK_ESCALATION",
          entityId: payload.escalation.id,
          metadata: {
            route: "/feedback",
            responseId: payload.response.id,
            surveyId: payload.survey.id,
            score: payload.response.score,
            type: payload.response.type,
          },
        });
      }
    }

    return {
      survey: mapFeedbackSurvey(payload.survey),
      response: {
        id: payload.response.id,
        score: payload.response.score,
        sentiment: payload.response.sentiment,
        submittedAt: payload.response.submittedAt,
      },
      escalation: payload.escalation
        ? {
            id: payload.escalation.id,
            status: payload.escalation.status,
            assignedToId: payload.escalation.assignedToId,
          }
        : null,
    };
  }

  static async getOverview(companyId: string, query: FeedbackOverviewQueryInput) {
    const window = getDateWindow(query);

    const where: Prisma.FeedbackResponseWhereInput = {
      companyId,
      submittedAt: window.from
        ? { gte: window.from, lte: window.to }
        : { lte: window.to },
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(query.teamId
        ? {
            OR: [
              {
                ticket: {
                  is: {
                    companyId,
                    teamId: query.teamId,
                  },
                },
              },
              {
                conversation: {
                  is: {
                    companyId,
                    teamId: query.teamId,
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [
      totalResponses,
      byType,
      bySentiment,
      csatAggregate,
      npsBreakdown,
      detractorOpenCount,
      trendRows,
    ] = await Promise.all([
      prisma.feedbackResponse.count({ where }),
      prisma.feedbackResponse.groupBy({
        by: ["type"],
        where,
        _count: { _all: true },
      }),
      prisma.feedbackResponse.groupBy({
        by: ["sentiment"],
        where,
        _count: { _all: true },
      }),
      prisma.feedbackResponse.aggregate({
        where: {
          ...where,
          type: FeedbackSurveyType.CSAT,
        },
        _avg: { score: true },
        _count: { _all: true },
      }),
      prisma.feedbackResponse.groupBy({
        by: ["sentiment"],
        where: {
          ...where,
          type: FeedbackSurveyType.NPS,
        },
        _count: { _all: true },
      }),
      prisma.feedbackEscalation.count({
        where: {
          companyId,
          status: {
            in: [FeedbackEscalationStatus.OPEN, FeedbackEscalationStatus.IN_PROGRESS],
          },
          response: {
            submittedAt: window.from
              ? { gte: window.from, lte: window.to }
              : { lte: window.to },
          },
        },
      }),
      prisma.$queryRaw<Array<{ day: Date; count: number; detractors: number }>>`
        SELECT
          DATE_TRUNC('day', fr."submittedAt")::date AS "day",
          COUNT(*)::int AS "count",
          COUNT(*) FILTER (WHERE fr."sentiment" = 'DETRACTOR')::int AS "detractors"
        FROM "FeedbackResponse" fr
        LEFT JOIN "Ticket" t
          ON t."id" = fr."ticketId"
         AND t."companyId" = fr."companyId"
        LEFT JOIN "Conversation" c
          ON c."id" = fr."conversationId"
         AND c."companyId" = fr."companyId"
        WHERE fr."companyId" = ${companyId}
          AND fr."submittedAt" <= ${window.to}
          ${window.from ? Prisma.sql`AND fr."submittedAt" >= ${window.from}` : Prisma.empty}
          ${query.channel
            ? Prisma.sql`AND fr."channel" = ${query.channel}::"ConversationChannel"`
            : Prisma.empty}
          ${query.assigneeId
            ? Prisma.sql`AND fr."assigneeId" = ${query.assigneeId}`
            : Prisma.empty}
          ${query.teamId
            ? Prisma.sql`AND (t."teamId" = ${query.teamId} OR c."teamId" = ${query.teamId})`
            : Prisma.empty}
        GROUP BY DATE_TRUNC('day', fr."submittedAt")
        ORDER BY DATE_TRUNC('day', fr."submittedAt") ASC
      `,
    ]);

    const typeCounts = Object.fromEntries(
      byType.map((item) => [item.type, item._count._all])
    ) as Partial<Record<FeedbackSurveyType, number>>;

    const sentimentCounts = Object.fromEntries(
      bySentiment.map((item) => [item.sentiment, item._count._all])
    ) as Partial<Record<FeedbackSentiment, number>>;

    const npsCounts = Object.fromEntries(
      npsBreakdown.map((item) => [item.sentiment, item._count._all])
    ) as Partial<Record<FeedbackSentiment, number>>;

    const npsTotal =
      (npsCounts[FeedbackSentiment.DETRACTOR] ?? 0) +
      (npsCounts[FeedbackSentiment.PASSIVE] ?? 0) +
      (npsCounts[FeedbackSentiment.PROMOTER] ?? 0);

    const npsScore =
      npsTotal > 0
        ? (((npsCounts[FeedbackSentiment.PROMOTER] ?? 0) -
            (npsCounts[FeedbackSentiment.DETRACTOR] ?? 0)) /
            npsTotal) *
          100
        : null;

    return {
      range: window.range,
      period: {
        from: window.from?.toISOString() ?? null,
        to: window.to.toISOString(),
      },
      filters: {
        teamId: query.teamId ?? null,
        channel: query.channel ?? null,
        assigneeId: query.assigneeId ?? null,
      },
      summary: {
        totalResponses,
        csatResponses: typeCounts[FeedbackSurveyType.CSAT] ?? 0,
        npsResponses: typeCounts[FeedbackSurveyType.NPS] ?? 0,
        openDetractorEscalations: detractorOpenCount,
      },
      csat: {
        average: csatAggregate._avg.score,
        responses: csatAggregate._count._all,
      },
      nps: {
        score: npsScore,
        responses: npsTotal,
        promoters: npsCounts[FeedbackSentiment.PROMOTER] ?? 0,
        passives: npsCounts[FeedbackSentiment.PASSIVE] ?? 0,
        detractors: npsCounts[FeedbackSentiment.DETRACTOR] ?? 0,
      },
      sentiments: {
        detractor: sentimentCounts[FeedbackSentiment.DETRACTOR] ?? 0,
        neutral: sentimentCounts[FeedbackSentiment.NEUTRAL] ?? 0,
        satisfied: sentimentCounts[FeedbackSentiment.SATISFIED] ?? 0,
        passive: sentimentCounts[FeedbackSentiment.PASSIVE] ?? 0,
        promoter: sentimentCounts[FeedbackSentiment.PROMOTER] ?? 0,
      },
      trends: trendRows.map((row) => ({
        date: row.day.toISOString().slice(0, 10),
        responses: Number(row.count),
        detractors: Number(row.detractors),
      })),
    };
  }

  static async getDetractors(companyId: string, query: FeedbackDetractorsQueryInput) {
    const escalations = await prisma.feedbackEscalation.findMany({
      where: {
        companyId,
        ...(query.status ? { status: query.status } : {}),
      },
      include: {
        survey: true,
        response: true,
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
        company: false,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
    });

    const customerIds = uniqueBy(
      escalations
        .map((item) => item.response.customerId)
        .filter(Boolean),
      (value) => value
    );

    const customers = customerIds.length
      ? await prisma.customer.findMany({
          where: {
            companyId,
            id: { in: customerIds },
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        })
      : [];

    const customerById = new Map(customers.map((customer) => [customer.id, customer]));

    const rows: Array<ReturnType<typeof mapFeedbackEscalation>> = [];

    for (const item of escalations) {
      const customer = customerById.get(item.response.customerId);
      if (!customer) continue;

      rows.push(
        mapFeedbackEscalation({
          ...item,
          customer,
        })
      );
    }

    const page = toPaginatedResult(rows, query.limit);

    return {
      ...page,
      items: page.items,
    };
  }

  static async getPendingSurveys(companyId: string, query: FeedbackPendingSurveysQueryInput) {
    const surveys = await prisma.feedbackSurvey.findMany({
      where: {
        companyId,
        completedAt: null,
        response: null,
        status: query.status
          ? query.status
          : {
              in: [
                FeedbackSurveyStatus.PENDING,
                FeedbackSurveyStatus.SENT,
                FeedbackSurveyStatus.EXPIRED,
              ],
            },
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
    });

    const page = toPaginatedResult(surveys, query.limit);
    const surveyIds = page.items.map((item) => item.id);

    const deliveryAudit = surveyIds.length
      ? await prisma.auditLog.findMany({
          where: {
            companyId,
            entityType: "FEEDBACK_SURVEY",
            entityId: { in: surveyIds },
            action: {
              in: [
                "FEEDBACK_SURVEY_DELIVERY_ATTEMPTED",
                "FEEDBACK_SURVEY_DELIVERY_PROVIDER_ACCEPTED",
                "FEEDBACK_SURVEY_DELIVERY_CONFIRMED",
                "FEEDBACK_SURVEY_DELIVERY_FAILED",
              ],
            },
          },
          select: {
            entityId: true,
            action: true,
            metadata: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        })
      : [];

    const latestDeliveryBySurvey = new Map<
      string,
      {
        status: "NOT_ATTEMPTED" | "ATTEMPTED" | "ACCEPTED" | "FAILED";
        attemptedAt: string | null;
        channel: ConversationChannel | null;
        detail: string | null;
      }
    >();

    for (const log of deliveryAudit) {
      if (latestDeliveryBySurvey.has(log.entityId)) continue;

      const metadata = (log.metadata && typeof log.metadata === "object"
        ? (log.metadata as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const channel =
        metadata.channel === ConversationChannel.WHATSAPP ||
        metadata.channel === ConversationChannel.EMAIL ||
        metadata.channel === ConversationChannel.WEBSITE ||
        metadata.channel === ConversationChannel.INSTAGRAM
          ? metadata.channel
          : null;

      const status =
        log.action === "FEEDBACK_SURVEY_DELIVERY_PROVIDER_ACCEPTED" ||
        log.action === "FEEDBACK_SURVEY_DELIVERY_CONFIRMED"
          ? "ACCEPTED"
          : log.action === "FEEDBACK_SURVEY_DELIVERY_FAILED"
            ? "FAILED"
            : "ATTEMPTED";

      latestDeliveryBySurvey.set(log.entityId, {
        status,
        attemptedAt: log.createdAt.toISOString(),
        channel,
        detail:
          typeof metadata.reason === "string"
            ? metadata.reason
            : typeof metadata.providerStatus === "string"
              ? metadata.providerStatus
              : null,
      });
    }

    const providerReadiness = await ChannelService.getProviderReadiness(companyId);

    return {
      ...page,
      items: page.items.map((survey) => {
        const handoff = getHandoffLink(companyId, survey.id);
        const delivery =
          latestDeliveryBySurvey.get(survey.id) ?? {
            status: "NOT_ATTEMPTED" as const,
            attemptedAt: null,
            channel: null,
            detail: null,
          };

        const canAttemptSend =
          Boolean(survey.conversationId) &&
          (survey.channel === ConversationChannel.WHATSAPP ||
            survey.channel === ConversationChannel.EMAIL ||
            survey.channel === ConversationChannel.WEBSITE);

        const providerReady =
          survey.channel === ConversationChannel.WHATSAPP
            ? providerReadiness.whatsapp.productionReady
            : survey.channel === ConversationChannel.EMAIL
              ? providerReadiness.email.productionReady
              : survey.channel === ConversationChannel.WEBSITE
                ? true
                : false;

        const providerReason =
          survey.channel === ConversationChannel.WHATSAPP
            ? providerReadiness.whatsapp.actionableErrors[0] ?? null
            : survey.channel === ConversationChannel.EMAIL
              ? providerReadiness.email.actionableErrors[0] ?? null
              : survey.channel === ConversationChannel.WEBSITE
                ? null
                : "Provider not supported for this survey channel";

        return {
          id: survey.id,
          type: survey.type,
          status: survey.status,
          triggerSource: survey.triggerSource,
          customer: survey.customer,
          channel: survey.channel,
          ticketId: survey.ticketId,
          conversationId: survey.conversationId,
          createdAt: survey.createdAt,
          expiresAt: survey.expiresAt,
          handoff: {
            linkAvailable: Boolean(handoff),
            handoffExpiresAt: handoff ? new Date(handoff.expiresAtMs).toISOString() : null,
          },
          delivery,
          sendCapabilities: {
            canAttemptSend,
            providerReady,
            providerReason: providerReady ? null : providerReason,
          },
        };
      }),
      providerReadiness,
    };
  }

  static async revealPendingSurveyLink(companyId: string, actorId: string, surveyId: string) {
    const survey = await prisma.feedbackSurvey.findFirst({
      where: {
        id: surveyId,
        companyId,
      },
      select: {
        id: true,
        status: true,
        completedAt: true,
      },
    });

    if (!survey) {
      throw new AppError("Feedback survey not found", HTTP_STATUS.NOT_FOUND);
    }

    if (survey.completedAt || survey.status === FeedbackSurveyStatus.COMPLETED) {
      throw new AppError("Cannot reveal link for a completed survey", HTTP_STATUS.CONFLICT);
    }

    const handoff = getHandoffLink(companyId, survey.id);
    if (!handoff) {
      throw new AppError(
        "Raw survey link is no longer available. Reissue token to generate a new link.",
        HTTP_STATUS.CONFLICT
      );
    }

    await AuditLogService.record({
      companyId,
      actorId,
      action: "FEEDBACK_SURVEY_LINK_REVEALED",
      entityType: "FEEDBACK_SURVEY",
      entityId: survey.id,
      metadata: {
        handoffExpiresAt: new Date(handoff.expiresAtMs).toISOString(),
      },
    });

    return {
      surveyId: survey.id,
      url: handoff.url,
      expiresAt: new Date(handoff.expiresAtMs).toISOString(),
    };
  }

  static async reissuePendingSurveyToken(
    companyId: string,
    actorId: string,
    surveyId: string,
    input: FeedbackSurveyReissueInput
  ) {
    const now = new Date();
    const token = generateSurveyToken();
    const tokenHash = hashToken(token);

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.feedbackSurvey.findFirst({
        where: {
          id: surveyId,
          companyId,
        },
        include: {
          response: {
            select: { id: true },
          },
        },
      });

      if (!existing) {
        throw new AppError("Feedback survey not found", HTTP_STATUS.NOT_FOUND);
      }

      if (existing.response || existing.completedAt || existing.status === FeedbackSurveyStatus.COMPLETED) {
        throw new AppError("Cannot reissue token for a completed survey", HTTP_STATUS.CONFLICT);
      }

      const nextExpiry =
        existing.expiresAt.getTime() <= now.getTime()
          ? new Date(now.getTime() + SURVEY_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
          : existing.expiresAt;

      return tx.feedbackSurvey.update({
        where: { id: existing.id },
        data: {
          tokenHash,
          status: FeedbackSurveyStatus.SENT,
          sentAt: now,
          completedAt: null,
          expiresAt: nextExpiry,
        },
      });
    });

    storeHandoffLink({
      companyId,
      surveyId: updated.id,
      token,
      surveyExpiresAt: updated.expiresAt,
    });

    const handoff = getHandoffLink(companyId, updated.id);
    if (!handoff) {
      throw new AppError("Could not prepare survey link handoff", HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }

    await AuditLogService.record({
      companyId,
      actorId,
      action: "FEEDBACK_SURVEY_TOKEN_REISSUED",
      entityType: "FEEDBACK_SURVEY",
      entityId: updated.id,
      metadata: {
        reason: input.reason ?? "operator_reissue",
        expiresAt: updated.expiresAt.toISOString(),
      },
    });

    return {
      surveyId: updated.id,
      status: updated.status,
      url: handoff.url,
      expiresAt: updated.expiresAt.toISOString(),
      handoffExpiresAt: new Date(handoff.expiresAtMs).toISOString(),
    };
  }

  static async deliverPendingSurvey(
    companyId: string,
    actorId: string,
    surveyId: string,
    input: FeedbackSurveyDeliveryInput
  ) {
    const survey = await prisma.feedbackSurvey.findFirst({
      where: {
        id: surveyId,
        companyId,
      },
      include: {
        response: {
          select: { id: true },
        },
        customer: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!survey) {
      throw new AppError("Feedback survey not found", HTTP_STATUS.NOT_FOUND);
    }

    if (survey.response || survey.completedAt || survey.status === FeedbackSurveyStatus.COMPLETED) {
      throw new AppError("Cannot deliver a completed survey", HTTP_STATUS.CONFLICT);
    }

    if (!survey.conversationId) {
      throw new AppError(
        "Survey is not linked to a provider-backed conversation. Use Copy link.",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const handoff = getHandoffLink(companyId, survey.id);
    if (!handoff) {
      throw new AppError(
        "Raw survey link is no longer available. Reissue token to deliver.",
        HTTP_STATUS.CONFLICT
      );
    }

    const targetChannel = input.channel ?? survey.channel;
    if (
      targetChannel !== ConversationChannel.WHATSAPP &&
      targetChannel !== ConversationChannel.EMAIL &&
      targetChannel !== ConversationChannel.WEBSITE
    ) {
      throw new AppError(
        "Only WhatsApp, Email, or Website surveys can be sent",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    if (targetChannel !== survey.channel) {
      throw new AppError(
        "Requested delivery channel does not match the survey conversation channel",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const linkedConversation = await prisma.conversation.findFirst({
      where: {
        id: survey.conversationId,
        companyId,
      },
      select: {
        id: true,
        channel: true,
      },
    });

    if (!linkedConversation) {
      throw new AppError(
        "Linked conversation is unavailable. Use Copy link or Reissue and copy.",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    if (linkedConversation.channel !== targetChannel) {
      throw new AppError(
        "Linked conversation channel does not match this survey delivery channel",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    const existingDeliveryMessage = await prisma.message.findFirst({
      where: {
        companyId,
        conversationId: survey.conversationId,
        sender: "AGENT",
        metadata: {
          path: ["feedbackSurveyId"],
          equals: survey.id,
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    if (existingDeliveryMessage) {
      return {
        surveyId: survey.id,
        channel: targetChannel,
        accepted: true,
        message: {
          id: existingDeliveryMessage.id,
          status: existingDeliveryMessage.status,
          conversationId: existingDeliveryMessage.conversationId,
        },
      };
    }

    const readiness = await ChannelService.getProviderReadiness(companyId);
    const providerReady =
      targetChannel === ConversationChannel.WHATSAPP
        ? readiness.whatsapp.productionReady
        : targetChannel === ConversationChannel.EMAIL
          ? readiness.email.productionReady
          : true;
    const providerReason =
      targetChannel === ConversationChannel.WHATSAPP
        ? readiness.whatsapp.actionableErrors[0] ?? "WhatsApp provider not ready"
        : targetChannel === ConversationChannel.EMAIL
          ? readiness.email.actionableErrors[0] ?? "Email provider not ready"
          : null;

    await AuditLogService.record({
      companyId,
      actorId,
      action: "FEEDBACK_SURVEY_DELIVERY_ATTEMPTED",
      entityType: "FEEDBACK_SURVEY",
      entityId: survey.id,
      metadata: {
        channel: targetChannel,
        conversationId: survey.conversationId,
      },
    });

    if (!providerReady && providerReason) {
      await AuditLogService.record({
        companyId,
        actorId,
        action: "FEEDBACK_SURVEY_DELIVERY_FAILED",
        entityType: "FEEDBACK_SURVEY",
        entityId: survey.id,
        metadata: {
          channel: targetChannel,
          reason: providerReason,
        },
      });

      throw new AppError(providerReason, HTTP_STATUS.BAD_REQUEST);
    }

    const customerName = [survey.customer.firstName, survey.customer.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
    const content = `${greeting} we'd value your feedback: ${handoff.url}`;

    try {
      const message = await MessageService.createMessage(
        { companyId, userId: actorId },
        {
          conversationId: survey.conversationId,
          sender: "AGENT",
          content,
          metadata: {
            feedbackSurveyId: survey.id,
            feedbackSurveyType: survey.type,
            feedbackDelivery: true,
          },
        }
      );

      const accepted =
        message.status === MessageStatus.SENT ||
        message.status === MessageStatus.DELIVERED ||
        message.status === MessageStatus.READ;

      if (accepted) {
        await AuditLogService.record({
          companyId,
          actorId,
          action:
            targetChannel === ConversationChannel.WEBSITE
              ? "FEEDBACK_SURVEY_DELIVERY_CONFIRMED"
              : "FEEDBACK_SURVEY_DELIVERY_PROVIDER_ACCEPTED",
          entityType: "FEEDBACK_SURVEY",
          entityId: survey.id,
          metadata: {
            channel: targetChannel,
            messageId: message.id,
            messageStatus: message.status,
          },
        });
      } else {
        await AuditLogService.record({
          companyId,
          actorId,
          action: "FEEDBACK_SURVEY_DELIVERY_FAILED",
          entityType: "FEEDBACK_SURVEY",
          entityId: survey.id,
          metadata: {
            channel: targetChannel,
            messageId: message.id,
            reason: `provider_status_${message.status}`,
          },
        });
      }

      return {
        surveyId: survey.id,
        channel: targetChannel,
        accepted,
        message: {
          id: message.id,
          status: message.status,
          conversationId: message.conversationId,
        },
      };
    } catch (error) {
      await AuditLogService.record({
        companyId,
        actorId,
        action: "FEEDBACK_SURVEY_DELIVERY_FAILED",
        entityType: "FEEDBACK_SURVEY",
        entityId: survey.id,
        metadata: {
          channel: targetChannel,
          reason: error instanceof Error ? error.message : "delivery_error",
        },
      });
      throw error;
    }
  }

  static async updateEscalation(
    companyId: string,
    actorId: string,
    escalationId: string,
    input: UpdateFeedbackEscalationInput
  ) {
    const existing = await prisma.feedbackEscalation.findFirst({
      where: {
        id: escalationId,
        companyId,
      },
      include: {
        response: true,
      },
    });

    if (!existing) {
      throw new AppError("Feedback escalation not found", HTTP_STATUS.NOT_FOUND);
    }

    if (input.assignedToId !== undefined && input.assignedToId !== null) {
      const assignee = await prisma.user.findFirst({
        where: {
          id: input.assignedToId,
          companyId,
          isActive: true,
          status: UserLifecycleStatus.ACTIVE,
        },
        select: { id: true },
      });

      if (!assignee) {
        throw new AppError("Assigned user not found", HTTP_STATUS.NOT_FOUND);
      }
    }

    const updated = await prisma.feedbackEscalation.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        reason: input.reason ?? existing.reason,
        ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId } : {}),
        resolvedAt:
          input.status === FeedbackEscalationStatus.RESOLVED ||
          input.status === FeedbackEscalationStatus.DISMISSED
            ? existing.resolvedAt ?? new Date()
            : null,
      },
    });

    await AuditLogService.record({
      companyId,
      actorId,
      action: "FEEDBACK_ESCALATION_UPDATED",
      entityType: "FEEDBACK_ESCALATION",
      entityId: updated.id,
      metadata: {
        fromStatus: existing.status,
        toStatus: updated.status,
        fromAssignee: existing.assignedToId,
        toAssignee: updated.assignedToId,
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      reason: updated.reason,
      assignedToId: updated.assignedToId,
      resolvedAt: updated.resolvedAt,
      updatedAt: updated.updatedAt,
    };
  }

  static buildSurveyPublicUrl(baseUrl: string, token: string) {
    const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    return `${normalized}/survey/${token}`;
  }

  static inferConversationChannel(channel: ConversationChannel | null | undefined) {
    return channel ?? null;
  }
}
