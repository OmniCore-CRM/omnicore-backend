import crypto from "node:crypto";
import {
  ConversationChannel,
  FeedbackEscalationStatus,
  FeedbackSentiment,
  FeedbackSurveyStatus,
  FeedbackSurveyType,
  FeedbackTriggerMode,
  FeedbackTriggerSource,
  NotificationType,
  Prisma,
  UserLifecycleStatus,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { toPaginatedResult } from "@/core/utils/pagination.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { NotificationService } from "@/modules/notifications/notification.service.js";
import {
  mapFeedbackEscalation,
  mapFeedbackSurvey,
  mapFeedbackTriggerConfig,
} from "./feedback.mapper.js";
import type {
  CreateFeedbackSurveyFromEventInput,
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
