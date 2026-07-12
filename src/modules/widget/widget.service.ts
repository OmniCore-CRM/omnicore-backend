import crypto from "node:crypto";
import {
  ConversationChannel,
  MessageSender,
  Prisma,
  TicketActivityAction,
  TicketPriority,
  TicketStatus,
  UserRole,
  WidgetArticleStatus,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { getIO } from "@/socket/socket.server.js";
import type {
  CreateWidgetConversationInput,
  CreateWidgetInstallationInput,
  CreateWidgetMessageInput,
  UpdateWidgetInstallationInput,
  WidgetMessagesQueryInput,
  WidgetPublicHelpCenterQueryInput,
  CreateWidgetFaqEntryInput,
  UpdateWidgetFaqEntryInput,
  CreateWidgetArticleCategoryInput,
  UpdateWidgetArticleCategoryInput,
  CreateWidgetArticleInput,
  UpdateWidgetArticleInput,
  UpdateWidgetArticleStatusInput,
  WidgetPublicAskInput,
  WidgetSupportHelpCenterQueryInput,
  WidgetSupportContactBodyInput,
} from "./widget.validation.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import {
  mapWidgetBootstrap,
  mapWidgetArticle,
  mapWidgetArticleCategory,
  mapPublicWidgetArticle,
  mapPublicWidgetArticles,
  mapPublicWidgetArticleCategories,
  mapWidgetArticleCategories,
  mapWidgetArticles,
  mapWidgetFaqEntries,
  mapWidgetFaqEntry,
  mapWidgetInstallation,
  mapWidgetInstallations,
  mapPublicWidgetConversation,
  mapPublicWidgetCustomer,
  mapPublicWidgetMessage,
  mapPublicWidgetMessages,
} from "./widget.mapper.js";
import {
  signWidgetSession,
  verifyWidgetSession,
} from "./widget.session.js";
import { toPaginatedResult } from "@/core/utils/pagination.js";
import { mapTicket } from "@/modules/tickets/ticket.mapper.js";
import { mapAttachments } from "@/modules/attachments/attachment.mapper.js";
import { AssignmentRuleService } from "@/modules/assignment-rules/assignment-rule.service.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { attachmentStorage } from "@/modules/attachments/attachment.storage.js";
import { validateBrandingFileSecurity } from "./widget.branding-upload.js";


const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

const widgetArticleInclude = {
  category: true,
  createdBy: {
    select: safeUserSelect,
  },
} satisfies Prisma.WidgetArticleInclude;

type WidgetArticleCategoryWithCount = Prisma.WidgetArticleCategoryGetPayload<{
  include: {
    _count: {
      select: {
        articles: true;
      };
    };
  };
}>;

type RequestOrigin = string | undefined;

const WIDGET_ACCESS_ERROR = "Widget is not available";
const WIDGET_MESSAGE_WINDOW_MS = 30 * 1000;
const WIDGET_MESSAGE_WINDOW_MAX = 5;
const PUBLIC_ANSWER_TOKEN_LIMIT = 12;
const PUBLIC_ANSWER_LIMIT = 3;

const normalizeQuestionText = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ");

const tokenizeQuestion = (question: string) => {
  const uniqueTokens = new Set(
    question
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );

  return Array.from(uniqueTokens).slice(0, PUBLIC_ANSWER_TOKEN_LIMIT);
};

const normalizeDomain = (domain: string) => {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) return "";

  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`
    );
    return url.host;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
};

const originToDomain = (origin: RequestOrigin) => {
  if (!origin) return "";

  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return normalizeDomain(origin);
  }
};

const normalizeAllowedDomains = (domains: string[]) => {
  return Array.from(
    new Set(domains.map(normalizeDomain).filter(Boolean))
  );
};

const normalizeCompanySlug = (value: string) =>
  value.trim().toLowerCase();

const createPublicKey = () =>
  `wpk_${crypto.randomBytes(24).toString("base64url")}`;

const activeTicketStatuses = [
  TicketStatus.OPEN,
  TicketStatus.PENDING,
  TicketStatus.ESCALATED,
];

const deriveTicketSubject = (content: string) => {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "Website support request";

  return normalized.length > 80
    ? `${normalized.slice(0, 77)}...`
    : normalized;
};

export class WidgetService {
  static async getInstallations(companyId: string) {
    const installations = await prisma.widgetInstallation.findMany({
      where: {
        companyId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return mapWidgetInstallations(installations);
  }

  static async createInstallation(
    companyId: string,
    data: CreateWidgetInstallationInput,
    actorId?: string
  ) {
    const installation = await prisma.widgetInstallation.create({
      data: {
        companyId,
        publicKey: createPublicKey(),
        allowedDomains: normalizeAllowedDomains(data.allowedDomains),
      },
    });

    await AuditLogService.record({
      companyId,
      actorId: actorId ?? null,
      action: "WIDGET_INSTALLATION_CREATED",
      entityType: "WIDGET_INSTALLATION",
      entityId: installation.id,
      metadata: {
        enabled: installation.enabled,
        allowedDomainsCount: installation.allowedDomains.length,
      },
    });

    return mapWidgetInstallation(installation);
  }

  static async updateInstallation(
    companyId: string,
    installationId: string,
    data: UpdateWidgetInstallationInput,
    actorId?: string
  ) {
    const installation = await prisma.widgetInstallation.findFirst({
      where: {
        id: installationId,
        companyId,
      },
    });

    if (!installation) {
      throw new AppError(
        "Widget installation not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    const updated = await prisma.widgetInstallation.update({
      where: {
        id: installation.id,
      },
      data: {
        ...(typeof data.enabled === "boolean"
          ? { enabled: data.enabled }
          : {}),
        ...(data.allowedDomains
          ? {
              allowedDomains: normalizeAllowedDomains(
                data.allowedDomains
              ),
            }
          : {}),
        // Phase 1: landing page customisation — empty string normalised to null
        ...(typeof data.companyDisplayName === "string"
          ? { companyDisplayName: data.companyDisplayName || null }
          : {}),
        ...(typeof data.welcomeTitle === "string"
          ? { welcomeTitle: data.welcomeTitle || null }
          : {}),
        ...(typeof data.welcomeSubtitle === "string"
          ? { welcomeSubtitle: data.welcomeSubtitle || null }
          : {}),
        ...(typeof data.chatGreeting === "string"
          ? { chatGreeting: data.chatGreeting || null }
          : {}),
        ...(typeof data.launcherLabel === "string"
          ? { launcherLabel: data.launcherLabel || null }
          : {}),
        ...(typeof data.footerNote === "string"
          ? { footerNote: data.footerNote || null }
          : {}),
        ...(data.messageShortcuts !== undefined
          ? { messageShortcuts: data.messageShortcuts }
          : {}),
        // Phase 3: branding
        ...(typeof data.brandColor === "string"
          ? { brandColor: data.brandColor || null }
          : {}),
      },
    });

    await AuditLogService.record({
      companyId,
      actorId: actorId ?? null,
      action: "WIDGET_INSTALLATION_UPDATED",
      entityType: "WIDGET_INSTALLATION",
      entityId: updated.id,
      metadata: {
        enabled: updated.enabled,
        allowedDomainsCount: updated.allowedDomains.length,
      },
    });

    return mapWidgetInstallation(updated);
  }

  static async bootstrap(publicKey: string, requestOrigin: RequestOrigin) {
    const installation = await this.resolveEnabledInstallation(
      publicKey,
      requestOrigin
    );

    const faqEntries = await prisma.widgetFaqEntry.findMany({
      where: { widgetInstallationId: installation.id, companyId: installation.companyId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return mapWidgetBootstrap(installation, faqEntries);
  }

  static async bootstrapByCompanySlug(companySlug: string) {
    const installation = await this.resolvePublicPortalInstallation(companySlug);

    const faqEntries = await prisma.widgetFaqEntry.findMany({
      where: {
        widgetInstallationId: installation.id,
        companyId: installation.companyId,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return mapWidgetBootstrap(installation, faqEntries);
  }

  static async authorizeConversationSession(
    publicKey: string,
    sessionToken: string,
    conversationId: string,
    requestOrigin: RequestOrigin
  ) {
    return this.resolveSession(
      publicKey,
      sessionToken,
      conversationId,
      requestOrigin
    );
  }

  static async createWidgetConversation(
    data: CreateWidgetConversationInput,
    requestOrigin: RequestOrigin
  ) {
    const installation = await this.resolveEnabledInstallation(
      data.publicKey,
      requestOrigin
    );

    const result = await this.createConversationFromPublicInput({
      companyId: installation.companyId,
      visitorName: data.visitorName,
      visitorEmail: data.visitorEmail,
      initialMessage: data.initialMessage,
    });

    const conversationDto = mapPublicWidgetConversation({
      ...result.conversation,
      customer: result.customer,
      messages: [result.message],
    });
    const messageDto = mapPublicWidgetMessage(result.message);
    const io = getIO();

    io.to(`company:${installation.companyId}`).emit(
      "new_conversation",
      conversationDto
    );
    io.to(`company:${installation.companyId}`).emit(
      "new_message",
      messageDto
    );
    io.to(`conversation:${result.conversation.id}`).emit(
      "new_message",
      messageDto
    );
    if (result.ticket.created) {
      io.to(`company:${installation.companyId}`).emit(
        "ticket_created",
        mapTicket(result.ticket.ticket)
      );
    }
    await AssignmentRuleService.applyConversationRules({
      companyId: installation.companyId,
      conversationId: result.conversation.id,
      channel: result.conversation.channel,
    });
    if (result.ticket.created) {
      await AssignmentRuleService.applyTicketRules({
        companyId: installation.companyId,
        ticketId: result.ticket.ticket.id,
        priority: result.ticket.ticket.priority,
      });
    }

    await AuditLogService.record({
      companyId: installation.companyId,
      action: "WIDGET_CONVERSATION_CREATED",
      entityType: "CONVERSATION",
      entityId: result.conversation.id,
      metadata: {
        channel: result.conversation.channel,
        customerId: result.customer.id,
        initialMessageId: result.message.id,
        ticketId: result.ticket.ticket.id,
        ticketCreated: result.ticket.created,
      },
    });

    return {
      sessionToken: signWidgetSession({
        tokenType: "widget_session",
        companyId: installation.companyId,
        widgetInstallationId: installation.id,
        conversationId: result.conversation.id,
        customerId: result.customer.id,
      }),
      customer: mapPublicWidgetCustomer(result.customer),
      conversation: conversationDto,
      message: messageDto,
      messages: [messageDto],
    };
  }

  static async contactSupportByCompanySlug(
    companySlug: string,
    data: WidgetSupportContactBodyInput
  ) {
    const installation = await this.resolvePublicPortalInstallation(companySlug);

    const result = await this.createConversationFromPublicInput({
      companyId: installation.companyId,
      visitorName: data.name,
      visitorEmail: data.email,
      visitorPhone: data.phone,
      initialMessage: data.message,
      ticketSubject: data.subject,
    });

    const conversationDto = mapPublicWidgetConversation({
      ...result.conversation,
      customer: result.customer,
      messages: [result.message],
    });
    const messageDto = mapPublicWidgetMessage(result.message);
    const io = getIO();

    io.to(`company:${installation.companyId}`).emit(
      "new_conversation",
      conversationDto
    );
    io.to(`company:${installation.companyId}`).emit(
      "new_message",
      messageDto
    );
    io.to(`conversation:${result.conversation.id}`).emit(
      "new_message",
      messageDto
    );
    if (result.ticket.created) {
      io.to(`company:${installation.companyId}`).emit(
        "ticket_created",
        mapTicket(result.ticket.ticket)
      );
    }

    await AssignmentRuleService.applyConversationRules({
      companyId: installation.companyId,
      conversationId: result.conversation.id,
      channel: result.conversation.channel,
    });
    if (result.ticket.created) {
      await AssignmentRuleService.applyTicketRules({
        companyId: installation.companyId,
        ticketId: result.ticket.ticket.id,
        priority: result.ticket.ticket.priority,
      });
    }

    await AuditLogService.record({
      companyId: installation.companyId,
      action: "WIDGET_CONVERSATION_CREATED",
      entityType: "CONVERSATION",
      entityId: result.conversation.id,
      metadata: {
        channel: result.conversation.channel,
        customerId: result.customer.id,
        initialMessageId: result.message.id,
        ticketId: result.ticket.ticket.id,
        ticketCreated: result.ticket.created,
        supportContact: true,
        supportSubject: data.subject,
      },
    });

    return {
      publicKey: installation.publicKey,
      customer: mapPublicWidgetCustomer(result.customer),
      conversation: conversationDto,
      message: messageDto,
      messages: [messageDto],
    };
  }

  static async getConversationMessages(
    conversationId: string,
    query: WidgetMessagesQueryInput,
    requestOrigin: RequestOrigin
  ) {
    const session = await this.resolveSession(
      query.key,
      query.sessionToken,
      conversationId,
      requestOrigin
    );

    const messages = await prisma.message.findMany({
      where: {
        companyId: session.companyId,
        conversationId,
      },
      include: {
        attachments: {
          include: {
            uploadedBy: { select: safeUserSelect },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: [
        {
          createdAt: "asc",
        },
        {
          id: "asc",
        },
      ],
      take: query.limit + 1,
      ...(query.cursor
        ? {
            cursor: {
              id: query.cursor,
            },
            skip: 1,
          }
        : {}),
    });

    const page = toPaginatedResult(messages, query.limit);

    const attachments = await prisma.attachment.findMany({
      where: {
        companyId: session.companyId,
        conversationId,
      },
      include: {
        uploadedBy: { select: safeUserSelect },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return {
      ...page,
      items: mapPublicWidgetMessages(page.items),
      attachments: mapAttachments(attachments),
    };
  }

  static async createWidgetMessage(
    conversationId: string,
    data: CreateWidgetMessageInput,
    requestOrigin: RequestOrigin
  ) {
    const session = await this.resolveSession(
      data.publicKey,
      data.sessionToken,
      conversationId,
      requestOrigin
    );

    await this.assertWidgetMessageVelocity(
      session.companyId,
      conversationId,
      session.customerId
    );

    const result = await prisma.$transaction(async (tx) => {
      const createdMessage = await tx.message.create({
        data: {
          companyId: session.companyId,
          conversationId,
          sender: MessageSender.CUSTOMER,
          content: data.content,
        },
      });

      await tx.conversation.update({
        where: {
          id: conversationId,
        },
        data: {
          updatedAt: new Date(),
        },
      });

      const ticket = await this.createOrTouchWidgetTicket(tx, {
        companyId: session.companyId,
        customerId: session.customerId,
        conversationId,
        messageContent: data.content,
        mode: "message",
      });

      return {
        message: createdMessage,
        ticket,
      };
    });

    const messageDto = mapPublicWidgetMessage(result.message);
    const io = getIO();

    io.to(`company:${session.companyId}`).emit(
      "new_message",
      messageDto
    );
    io.to(`conversation:${conversationId}`).emit(
      "new_message",
      messageDto
    );
    if (result.ticket.created) {
      io.to(`company:${session.companyId}`).emit(
        "ticket_created",
        mapTicket(result.ticket.ticket)
      );
    }

    await AuditLogService.record({
      companyId: session.companyId,
      action: "WIDGET_MESSAGE_RECEIVED",
      entityType: "MESSAGE",
      entityId: result.message.id,
      metadata: {
        conversationId,
        ticketId: result.ticket.ticket.id,
        ticketCreated: result.ticket.created,
      },
    });

    return messageDto;
  }

  private static async assertWidgetMessageVelocity(
    companyId: string,
    conversationId: string | null,
    customerId: string | null
  ) {
    const recentCustomerMessages = await prisma.message.count({
      where: {
        companyId,
        sender: MessageSender.CUSTOMER,
        createdAt: {
          gte: new Date(Date.now() - WIDGET_MESSAGE_WINDOW_MS),
        },
        ...(conversationId ? { conversationId } : {}),
        ...(customerId
          ? { conversation: { customerId } }
          : {}),
      },
    });

    if (recentCustomerMessages >= WIDGET_MESSAGE_WINDOW_MAX) {
      throw new AppError(
        "Too many messages. Please wait before sending again.",
        HTTP_STATUS.TOO_MANY_REQUESTS
      );
    }
  }

  private static async resolveEnabledInstallation(
    publicKey: string,
    requestOrigin: RequestOrigin
  ) {
    const installation = await prisma.widgetInstallation.findUnique({
      where: {
        publicKey,
      },
    });

    if (!installation?.enabled) {
      throw new AppError(
        WIDGET_ACCESS_ERROR,
        HTTP_STATUS.FORBIDDEN
      );
    }

    const requestDomain = originToDomain(requestOrigin);
    const allowedDomains = installation.allowedDomains.map(
      normalizeDomain
    );

    if (
      !requestDomain ||
      !allowedDomains.includes(requestDomain)
    ) {
      throw new AppError(
        WIDGET_ACCESS_ERROR,
        HTTP_STATUS.FORBIDDEN
      );
    }

    return installation;
  }

  private static async resolvePublicPortalInstallation(companySlug: string) {
    const normalizedSlug = normalizeCompanySlug(companySlug);

    const company = await prisma.company.findFirst({
      where: {
        companySlug: normalizedSlug,
        isActive: true,
        supportPortalEnabled: true,
      },
      select: {
        id: true,
      },
    });

    if (!company) {
      throw new AppError("Support portal is unavailable", HTTP_STATUS.NOT_FOUND);
    }

    const installation = await prisma.widgetInstallation.findFirst({
      where: {
        companyId: company.id,
        enabled: true,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });

    if (!installation) {
      throw new AppError("Support portal is unavailable", HTTP_STATUS.NOT_FOUND);
    }

    return installation;
  }

  private static async resolveSession(
    publicKey: string,
    sessionToken: string,
    conversationId: string,
    requestOrigin: RequestOrigin
  ) {
    const installation = await this.resolveEnabledInstallation(
      publicKey,
      requestOrigin
    );

    try {
      const session = verifyWidgetSession(sessionToken);

      if (
        session.tokenType !== "widget_session" ||
        session.widgetInstallationId !== installation.id ||
        session.companyId !== installation.companyId ||
        session.conversationId !== conversationId
      ) {
        throw new Error("Widget session mismatch");
      }

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          companyId: session.companyId,
          customerId: session.customerId,
          channel: ConversationChannel.WEBSITE,
        },
        select: {
          id: true,
        },
      });

      if (!conversation) {
        throw new Error("Widget conversation unavailable");
      }

      return session;
    } catch {
      throw new AppError(
        WIDGET_ACCESS_ERROR,
        HTTP_STATUS.FORBIDDEN
      );
    }
  }

  private static async createOrTouchWidgetTicket(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      customerId: string;
      conversationId: string;
      messageContent: string;
      subject?: string;
      mode: "create";
      actorId: string;
      slaPolicy?: {
        firstResponseMinutes: number;
        resolutionMinutes: number;
      } | null;
    } | {
      companyId: string;
      customerId: string;
      conversationId: string;
      messageContent: string;
      subject?: string;
      mode: "message";
      actorId?: string;
      slaPolicy?: {
        firstResponseMinutes: number;
        resolutionMinutes: number;
      } | null;
    }
  ) {
    const existingActiveTicket = await tx.ticket.findFirst({
      where: {
        companyId: input.companyId,
        conversationId: input.conversationId,
        status: {
          in: activeTicketStatuses,
        },
      },
      include: {
        assignee: { select: safeUserSelect },
        createdBy: { select: safeUserSelect },
        customer: true,
        conversation: true,
      },
      orderBy: [
        {
          updatedAt: "desc",
        },
        {
          id: "desc",
        },
      ],
    });

    if (existingActiveTicket) {
      await tx.ticket.update({
        where: {
          id: existingActiveTicket.id,
        },
        data: {
          updatedAt: new Date(),
        },
      });

      await tx.ticketActivity.create({
        data: {
          companyId: input.companyId,
          ticketId: existingActiveTicket.id,
          actorId: input.actorId ?? null,
          action: TicketActivityAction.MESSAGE_RECEIVED_ON_WIDGET,
          metadata: {
            source: "widget",
            conversationId: input.conversationId,
          },
        },
      });

      return {
        ticket: existingActiveTicket,
        created: false,
      };
    }

    const createdById =
      input.actorId ??
      (await this.resolveWidgetAutomationActorId(input.companyId));
    const createdAt = new Date();
    const createdTicket = await tx.ticket.create({
      data: {
        companyId: input.companyId,
        customerId: input.customerId,
        conversationId: input.conversationId,
        createdById,
        subject: input.subject?.trim() || deriveTicketSubject(input.messageContent),
        description: input.messageContent,
        status: TicketStatus.OPEN,
        priority: TicketPriority.MEDIUM,
        ...(input.slaPolicy
          ? {
              firstResponseDueAt: new Date(
                createdAt.getTime() + input.slaPolicy.firstResponseMinutes * 60_000
              ),
              resolutionDueAt: new Date(
                createdAt.getTime() + input.slaPolicy.resolutionMinutes * 60_000
              ),
            }
          : {}),
      },
      include: {
        assignee: { select: safeUserSelect },
        createdBy: { select: safeUserSelect },
        customer: true,
        conversation: true,
      },
    });

    await tx.ticketActivity.create({
      data: {
        companyId: input.companyId,
        ticketId: createdTicket.id,
        actorId: input.actorId,
        action: TicketActivityAction.TICKET_CREATED_FROM_WIDGET,
        metadata: {
          source: "widget",
          channel: ConversationChannel.WEBSITE,
          conversationId: input.conversationId,
          customerId: input.customerId,
          priority: TicketPriority.MEDIUM,
          trigger: input.mode,
          subject: input.subject?.trim() || deriveTicketSubject(input.messageContent),
        },
      },
    });

    return {
      ticket: createdTicket,
      created: true,
    };
  }

  private static async createConversationFromPublicInput(input: {
    companyId: string;
    visitorName: string;
    visitorEmail?: string;
    visitorPhone?: string;
    initialMessage: string;
    ticketSubject?: string;
  }) {
    const [actor, slaPolicy] = await Promise.all([
      prisma.user.findFirst({
        where: {
          companyId: input.companyId,
          role: {
            in: [
              UserRole.OWNER,
              UserRole.ADMIN,
              UserRole.TEAM_LEAD,
              UserRole.AGENT,
              UserRole.SUPER_ADMIN,
            ],
          },
        },
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
        },
      }),
      prisma.slaPolicy.findFirst({
        where: {
          companyId: input.companyId,
          priority: TicketPriority.MEDIUM,
          enabled: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
      }),
    ]);

    if (!actor) {
      throw new AppError(
        "Widget ticket automation is not configured",
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }

    return prisma.$transaction(async (tx) => {
      const existingCustomer = input.visitorEmail
        ? await tx.customer.findFirst({
            where: {
              companyId: input.companyId,
              email: input.visitorEmail,
            },
          })
        : null;

      const customer = existingCustomer
        ? await tx.customer.update({
            where: {
              id: existingCustomer.id,
            },
            data: {
              firstName: input.visitorName,
              ...(input.visitorPhone ? { phone: input.visitorPhone } : {}),
            },
          })
        : await tx.customer.create({
            data: {
              companyId: input.companyId,
              firstName: input.visitorName,
              email: input.visitorEmail,
              ...(input.visitorPhone ? { phone: input.visitorPhone } : {}),
            },
          });

      const conversation = await tx.conversation.create({
        data: {
          companyId: input.companyId,
          customerId: customer.id,
          channel: ConversationChannel.WEBSITE,
          subject:
            input.ticketSubject?.trim() || deriveTicketSubject(input.initialMessage),
        },
      });

      const message = await tx.message.create({
        data: {
          companyId: input.companyId,
          conversationId: conversation.id,
          sender: MessageSender.CUSTOMER,
          content: input.initialMessage,
        },
      });

      const ticket = await this.createOrTouchWidgetTicket(tx, {
        companyId: input.companyId,
        customerId: customer.id,
        conversationId: conversation.id,
        messageContent: input.initialMessage,
        subject: input.ticketSubject,
        mode: "create",
        actorId: actor.id,
        slaPolicy: slaPolicy
          ? {
              firstResponseMinutes: slaPolicy.firstResponseMinutes,
              resolutionMinutes: slaPolicy.resolutionMinutes,
            }
          : null,
      });

      return {
        customer,
        conversation,
        message,
        ticket,
      };
    }, { timeout: 15_000 });
  }

  private static async resolveWidgetAutomationActorId(companyId: string) {
    const actor = await prisma.user.findFirst({
      where: {
        companyId,
        role: {
          in: [
            UserRole.OWNER,
            UserRole.ADMIN,
            UserRole.TEAM_LEAD,
            UserRole.AGENT,
            UserRole.SUPER_ADMIN,
          ],
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
      },
    });

    if (!actor) {
      throw new AppError(
        "Widget ticket automation is not configured",
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }

    return actor.id;
  }

  // ===== FAQ management (admin) =====

  static async listFaqEntries(companyId: string, installationId: string) {
    await this.resolveOwnedInstallation(companyId, installationId);
    const entries = await prisma.widgetFaqEntry.findMany({
      where: { widgetInstallationId: installationId, companyId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return mapWidgetFaqEntries(entries);
  }

  static async createFaqEntry(
    companyId: string,
    installationId: string,
    data: CreateWidgetFaqEntryInput
  ) {
    await this.resolveOwnedInstallation(companyId, installationId);
    const entry = await prisma.widgetFaqEntry.create({
      data: {
        widgetInstallationId: installationId,
        companyId,
        question: data.question,
        answer: data.answer,
        sortOrder: data.sortOrder ?? 0,
      },
    });
    return mapWidgetFaqEntry(entry);
  }

  static async updateFaqEntry(
    companyId: string,
    installationId: string,
    faqId: string,
    data: UpdateWidgetFaqEntryInput
  ) {
    await this.resolveOwnedFaqEntry(companyId, installationId, faqId);
    const updated = await prisma.widgetFaqEntry.update({
      where: { id: faqId },
      data: {
        ...(typeof data.question === "string" ? { question: data.question } : {}),
        ...(typeof data.answer === "string" ? { answer: data.answer } : {}),
        ...(typeof data.sortOrder === "number" ? { sortOrder: data.sortOrder } : {}),
      },
    });
    return mapWidgetFaqEntry(updated);
  }

  static async deleteFaqEntry(
    companyId: string,
    installationId: string,
    faqId: string
  ) {
    await this.resolveOwnedFaqEntry(companyId, installationId, faqId);
    await prisma.widgetFaqEntry.delete({ where: { id: faqId } });
  }

  // ===== Knowledge base management (admin) =====

  static async listArticleCategories(companyId: string, installationId: string) {
    await this.resolveOwnedInstallation(companyId, installationId);

    const categories = await prisma.widgetArticleCategory.findMany({
      where: {
        companyId,
        widgetInstallationId: installationId,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return mapWidgetArticleCategories(categories);
  }

  static async createArticleCategory(
    companyId: string,
    installationId: string,
    data: CreateWidgetArticleCategoryInput,
    actorId?: string
  ) {
    await this.resolveOwnedInstallation(companyId, installationId);

    try {
      const category = await prisma.widgetArticleCategory.create({
        data: {
          companyId,
          widgetInstallationId: installationId,
          name: data.name,
          slug: data.slug,
          sortOrder: data.sortOrder ?? 0,
        },
      });

      await AuditLogService.record({
        companyId,
        actorId: actorId ?? null,
        action: "WIDGET_ARTICLE_CATEGORY_CREATED",
        entityType: "WIDGET_ARTICLE_CATEGORY",
        entityId: category.id,
        metadata: {
          widgetInstallationId: installationId,
          name: category.name,
          slug: category.slug,
        },
      });

      return mapWidgetArticleCategory(category);
    } catch (error) {
      this.throwIfDuplicateSlug(error, "A category with this slug already exists for this widget");
      throw error;
    }
  }

  static async updateArticleCategory(
    companyId: string,
    installationId: string,
    categoryId: string,
    data: UpdateWidgetArticleCategoryInput,
    actorId?: string
  ) {
    await this.resolveOwnedArticleCategory(companyId, installationId, categoryId);

    try {
      const category = await prisma.widgetArticleCategory.update({
        where: { id: categoryId },
        data: {
          ...(typeof data.name === "string" ? { name: data.name } : {}),
          ...(typeof data.slug === "string" ? { slug: data.slug } : {}),
          ...(typeof data.sortOrder === "number" ? { sortOrder: data.sortOrder } : {}),
        },
      });

      await AuditLogService.record({
        companyId,
        actorId: actorId ?? null,
        action: "WIDGET_ARTICLE_CATEGORY_UPDATED",
        entityType: "WIDGET_ARTICLE_CATEGORY",
        entityId: category.id,
        metadata: {
          widgetInstallationId: installationId,
          name: category.name,
          slug: category.slug,
        },
      });

      return mapWidgetArticleCategory(category);
    } catch (error) {
      this.throwIfDuplicateSlug(error, "A category with this slug already exists for this widget");
      throw error;
    }
  }

  static async deleteArticleCategory(
    companyId: string,
    installationId: string,
    categoryId: string,
    actorId?: string
  ) {
    const category = (await this.resolveOwnedArticleCategory(
      companyId,
      installationId,
      categoryId,
      true
    )) as WidgetArticleCategoryWithCount;

    if (category._count.articles > 0) {
      throw new AppError(
        "Cannot delete category with assigned articles. Unassign or archive them first.",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    await prisma.widgetArticleCategory.delete({ where: { id: categoryId } });

    await AuditLogService.record({
      companyId,
      actorId: actorId ?? null,
      action: "WIDGET_ARTICLE_CATEGORY_DELETED",
      entityType: "WIDGET_ARTICLE_CATEGORY",
      entityId: categoryId,
      metadata: {
        widgetInstallationId: installationId,
        name: category.name,
        slug: category.slug,
      },
    });
  }

  static async listArticles(companyId: string, installationId: string) {
    await this.resolveOwnedInstallation(companyId, installationId);

    const articles = await prisma.widgetArticle.findMany({
      where: {
        companyId,
        widgetInstallationId: installationId,
      },
      include: widgetArticleInclude,
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }, { id: "desc" }],
    });

    return mapWidgetArticles(articles);
  }

  static async getArticle(companyId: string, installationId: string, articleId: string) {
    const article = await this.resolveOwnedArticle(companyId, installationId, articleId, true);
    return mapWidgetArticle(article as Prisma.WidgetArticleGetPayload<{ include: typeof widgetArticleInclude }>);
  }

  static async createArticle(
    companyId: string,
    installationId: string,
    data: CreateWidgetArticleInput,
    actorId?: string
  ) {
    await this.resolveOwnedInstallation(companyId, installationId);
    await this.assertValidCategory(companyId, installationId, data.categoryId ?? null);

    try {
      const article = await prisma.widgetArticle.create({
        data: {
          companyId,
          widgetInstallationId: installationId,
          title: data.title,
          slug: data.slug,
          summary: data.summary,
          content: data.content,
          categoryId: data.categoryId ?? null,
          sortOrder: data.sortOrder ?? 0,
          createdById: actorId ?? null,
        },
        include: widgetArticleInclude,
      });

      await AuditLogService.record({
        companyId,
        actorId: actorId ?? null,
        action: "WIDGET_ARTICLE_CREATED",
        entityType: "WIDGET_ARTICLE",
        entityId: article.id,
        metadata: {
          widgetInstallationId: installationId,
          title: article.title,
          slug: article.slug,
          status: article.status,
        },
      });

      return mapWidgetArticle(article);
    } catch (error) {
      this.throwIfDuplicateSlug(error, "An article with this slug already exists for this widget");
      throw error;
    }
  }

  static async updateArticle(
    companyId: string,
    installationId: string,
    articleId: string,
    data: UpdateWidgetArticleInput,
    actorId?: string
  ) {
    await this.resolveOwnedArticle(companyId, installationId, articleId);
    await this.assertValidCategory(
      companyId,
      installationId,
      Object.prototype.hasOwnProperty.call(data, "categoryId")
        ? (data.categoryId ?? null)
        : undefined
    );

    try {
      const article = await prisma.widgetArticle.update({
        where: { id: articleId },
        data: {
          ...(typeof data.title === "string" ? { title: data.title } : {}),
          ...(typeof data.slug === "string" ? { slug: data.slug } : {}),
          ...(typeof data.summary === "string" ? { summary: data.summary } : {}),
          ...(typeof data.content === "string" ? { content: data.content } : {}),
          ...(typeof data.sortOrder === "number" ? { sortOrder: data.sortOrder } : {}),
          ...(Object.prototype.hasOwnProperty.call(data, "categoryId")
            ? { categoryId: data.categoryId ?? null }
            : {}),
        },
        include: widgetArticleInclude,
      });

      await AuditLogService.record({
        companyId,
        actorId: actorId ?? null,
        action: "WIDGET_ARTICLE_UPDATED",
        entityType: "WIDGET_ARTICLE",
        entityId: article.id,
        metadata: {
          widgetInstallationId: installationId,
          title: article.title,
          slug: article.slug,
          status: article.status,
        },
      });

      return mapWidgetArticle(article);
    } catch (error) {
      this.throwIfDuplicateSlug(error, "An article with this slug already exists for this widget");
      throw error;
    }
  }

  static async updateArticleStatus(
    companyId: string,
    installationId: string,
    articleId: string,
    data: UpdateWidgetArticleStatusInput,
    actorId?: string
  ) {
    const existing = await this.resolveOwnedArticle(companyId, installationId, articleId);

    const nextStatus = data.status as WidgetArticleStatus;
    const currentStatus = existing.status;

    const isLegalTransition =
      (currentStatus === WidgetArticleStatus.DRAFT && nextStatus === WidgetArticleStatus.PUBLISHED) ||
      (currentStatus === WidgetArticleStatus.PUBLISHED && nextStatus === WidgetArticleStatus.ARCHIVED) ||
      (currentStatus === WidgetArticleStatus.ARCHIVED && nextStatus === WidgetArticleStatus.PUBLISHED);

    if (!isLegalTransition) {
      throw new AppError("Illegal article status transition", HTTP_STATUS.BAD_REQUEST);
    }

    const article = await prisma.widgetArticle.update({
      where: { id: articleId },
      data: {
        status: nextStatus,
        ...(nextStatus === WidgetArticleStatus.PUBLISHED ? { publishedAt: new Date() } : {}),
      },
      include: widgetArticleInclude,
    });

    await AuditLogService.record({
      companyId,
      actorId: actorId ?? null,
      action:
        nextStatus === WidgetArticleStatus.PUBLISHED
          ? "WIDGET_ARTICLE_PUBLISHED"
          : "WIDGET_ARTICLE_ARCHIVED",
      entityType: "WIDGET_ARTICLE",
      entityId: article.id,
      metadata: {
        widgetInstallationId: installationId,
        title: article.title,
        slug: article.slug,
        previousStatus: currentStatus,
        status: article.status,
      },
    });

    return mapWidgetArticle(article);
  }

  static async listPublicHelpCenter(
    query: WidgetPublicHelpCenterQueryInput,
    requestOrigin: RequestOrigin
  ) {
    const installation = await this.resolveEnabledInstallation(
      query.key,
      requestOrigin
    );

    const normalizedSearch = query.search?.trim();
    const normalizedCategory = query.category?.trim();

    const [categories, articles] = await Promise.all([
      prisma.widgetArticleCategory.findMany({
        where: {
          companyId: installation.companyId,
          widgetInstallationId: installation.id,
          articles: {
            some: {
              companyId: installation.companyId,
              widgetInstallationId: installation.id,
              status: WidgetArticleStatus.PUBLISHED,
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.widgetArticle.findMany({
        where: {
          companyId: installation.companyId,
          widgetInstallationId: installation.id,
          status: WidgetArticleStatus.PUBLISHED,
          ...(normalizedCategory
            ? {
                category: {
                  slug: normalizedCategory,
                },
              }
            : {}),
          ...(normalizedSearch
            ? {
                OR: [
                  {
                    title: {
                      contains: normalizedSearch,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                  {
                    summary: {
                      contains: normalizedSearch,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                  {
                    content: {
                      contains: normalizedSearch,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                ],
              }
            : {}),
        },
        include: {
          category: true,
        },
        orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }, { id: "desc" }],
      }),
    ]);

    return {
      publicKey: installation.publicKey,
      companyDisplayName: installation.companyDisplayName,
      welcomeTitle: installation.welcomeTitle,
      welcomeSubtitle: installation.welcomeSubtitle,
      chatGreeting: installation.chatGreeting,
      launcherLabel: installation.launcherLabel,
      footerNote: installation.footerNote,
      messageShortcuts: installation.messageShortcuts,
      logoUrl: installation.logoUrl,
      heroImageUrl: installation.heroImageUrl,
      brandColor: installation.brandColor,
      filters: {
        category: normalizedCategory ?? null,
        search: normalizedSearch ?? "",
      },
      categories: mapPublicWidgetArticleCategories(categories),
      articles: mapPublicWidgetArticles(articles),
    };
  }

  static async getPublicHelpCenterArticle(
    publicKey: string,
    slug: string,
    requestOrigin: RequestOrigin
  ) {
    const installation = await this.resolveEnabledInstallation(
      publicKey,
      requestOrigin
    );

    const article = await prisma.widgetArticle.findFirst({
      where: {
        companyId: installation.companyId,
        widgetInstallationId: installation.id,
        slug,
        status: WidgetArticleStatus.PUBLISHED,
      },
      include: {
        category: true,
      },
    });

    if (!article) {
      throw new AppError("Article not found", HTTP_STATUS.NOT_FOUND);
    }

    return {
      publicKey: installation.publicKey,
      companyDisplayName: installation.companyDisplayName,
      chatGreeting: installation.chatGreeting,
      launcherLabel: installation.launcherLabel,
      messageShortcuts: installation.messageShortcuts,
      logoUrl: installation.logoUrl,
      brandColor: installation.brandColor,
      article: mapPublicWidgetArticle(article),
    };
  }

  static async answerPublicHelpCenterQuestion(
    input: WidgetPublicAskInput,
    requestOrigin: RequestOrigin
  ) {
    const installation = await this.resolveEnabledInstallation(
      input.publicKey,
      requestOrigin
    );

    const normalizedQuestion = normalizeQuestionText(input.question);
    const tokens = tokenizeQuestion(normalizedQuestion);

    const baseWhere = {
      companyId: installation.companyId,
      widgetInstallationId: installation.id,
      status: WidgetArticleStatus.PUBLISHED,
    } satisfies Prisma.WidgetArticleWhereInput;

    const publishedCount = await prisma.widgetArticle.count({
      where: baseWhere,
    });

    if (publishedCount === 0) {
      return {
        publicKey: installation.publicKey,
        question: normalizedQuestion,
        state: "EMPTY" as const,
        message:
          "No published help articles are available yet. Please check back later.",
        answer: null,
        suggestions: [],
      };
    }

    const candidates = await prisma.widgetArticle.findMany({
      where: {
        ...baseWhere,
        OR: [
          {
            title: {
              contains: normalizedQuestion,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            summary: {
              contains: normalizedQuestion,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            content: {
              contains: normalizedQuestion,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          ...tokens.flatMap((token) => [
            {
              title: {
                contains: token,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              summary: {
                contains: token,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              content: {
                contains: token,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          ]),
        ],
      },
      include: {
        category: true,
      },
      orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }, { id: "desc" }],
      take: 30,
    });

    if (candidates.length === 0) {
      return {
        publicKey: installation.publicKey,
        question: normalizedQuestion,
        state: "NO_MATCH" as const,
        message:
          "No matching answer found. Try rephrasing your question or browsing Help Centre articles.",
        answer: null,
        suggestions: [],
      };
    }

    const questionLc = normalizedQuestion.toLowerCase();
    const scored = candidates
      .map((article) => {
        const title = article.title.toLowerCase();
        const summary = article.summary.toLowerCase();
        const content = article.content.toLowerCase();

        let score = 0;

        if (title.includes(questionLc)) score += 120;
        if (summary.includes(questionLc)) score += 80;
        if (content.includes(questionLc)) score += 40;

        for (const token of tokens) {
          if (title.includes(token)) score += 16;
          if (summary.includes(token)) score += 10;
          if (content.includes(token)) score += 5;
        }

        const excerptSource = article.content.trim() || article.summary.trim();
        const excerpt =
          excerptSource.length > 280
            ? `${excerptSource.slice(0, 277)}...`
            : excerptSource;

        return {
          score,
          article: mapPublicWidgetArticle(article),
          excerpt,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, PUBLIC_ANSWER_LIMIT);

    const [best, ...suggestions] = scored;

    return {
      publicKey: installation.publicKey,
      question: normalizedQuestion,
      state: "ANSWERED" as const,
      message: "Found matching help article answers.",
      answer: best
        ? {
            article: best.article,
            excerpt: best.excerpt,
          }
        : null,
      suggestions: suggestions.map((item) => ({
        article: item.article,
        excerpt: item.excerpt,
      })),
    };
  }

  static async listPublicHelpCenterByCompanySlug(
    companySlug: string,
    query: WidgetSupportHelpCenterQueryInput
  ) {
    const installation = await this.resolvePublicPortalInstallation(companySlug);

    const normalizedSearch = query.search?.trim();
    const normalizedCategory = query.category?.trim();

    const [categories, articles] = await Promise.all([
      prisma.widgetArticleCategory.findMany({
        where: {
          companyId: installation.companyId,
          widgetInstallationId: installation.id,
          articles: {
            some: {
              companyId: installation.companyId,
              widgetInstallationId: installation.id,
              status: WidgetArticleStatus.PUBLISHED,
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.widgetArticle.findMany({
        where: {
          companyId: installation.companyId,
          widgetInstallationId: installation.id,
          status: WidgetArticleStatus.PUBLISHED,
          ...(normalizedCategory
            ? {
                category: {
                  slug: normalizedCategory,
                },
              }
            : {}),
          ...(normalizedSearch
            ? {
                OR: [
                  {
                    title: {
                      contains: normalizedSearch,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                  {
                    summary: {
                      contains: normalizedSearch,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                  {
                    content: {
                      contains: normalizedSearch,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                ],
              }
            : {}),
        },
        include: {
          category: true,
        },
        orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }, { id: "desc" }],
      }),
    ]);

    return {
      publicKey: installation.publicKey,
      companyDisplayName: installation.companyDisplayName,
      welcomeTitle: installation.welcomeTitle,
      welcomeSubtitle: installation.welcomeSubtitle,
      chatGreeting: installation.chatGreeting,
      launcherLabel: installation.launcherLabel,
      footerNote: installation.footerNote,
      messageShortcuts: installation.messageShortcuts,
      logoUrl: installation.logoUrl,
      heroImageUrl: installation.heroImageUrl,
      brandColor: installation.brandColor,
      filters: {
        category: normalizedCategory ?? null,
        search: normalizedSearch ?? "",
      },
      categories: mapPublicWidgetArticleCategories(categories),
      articles: mapPublicWidgetArticles(articles),
    };
  }

  static async getPublicHelpCenterArticleByCompanySlug(
    companySlug: string,
    articleSlug: string
  ) {
    const installation = await this.resolvePublicPortalInstallation(companySlug);

    const article = await prisma.widgetArticle.findFirst({
      where: {
        companyId: installation.companyId,
        widgetInstallationId: installation.id,
        slug: articleSlug,
        status: WidgetArticleStatus.PUBLISHED,
      },
      include: {
        category: true,
      },
    });

    if (!article) {
      throw new AppError("Article not found", HTTP_STATUS.NOT_FOUND);
    }

    return {
      publicKey: installation.publicKey,
      companyDisplayName: installation.companyDisplayName,
      chatGreeting: installation.chatGreeting,
      launcherLabel: installation.launcherLabel,
      messageShortcuts: installation.messageShortcuts,
      logoUrl: installation.logoUrl,
      brandColor: installation.brandColor,
      article: mapPublicWidgetArticle(article),
    };
  }

  static async getSupportSitemapData() {
    const companies = await prisma.company.findMany({
      where: {
        isActive: true,
        supportPortalEnabled: true,
        companySlug: {
          not: null,
        },
      },
      select: {
        id: true,
        companySlug: true,
        widgetInstallations: {
          where: {
            enabled: true,
          },
          orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
          take: 1,
          select: {
            id: true,
            updatedAt: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });

    const installations = companies
      .map((company) => {
        const installation = company.widgetInstallations[0];
        if (!company.companySlug || !installation) {
          return null;
        }

        return {
          companyId: company.id,
          companySlug: company.companySlug,
          installationId: installation.id,
          installationUpdatedAt: installation.updatedAt,
        };
      })
      .filter((item): item is {
        companyId: string;
        companySlug: string;
        installationId: string;
        installationUpdatedAt: Date;
      } => Boolean(item));

    if (installations.length === 0) {
      return {
        portals: [],
      };
    }

    const articles = await prisma.widgetArticle.findMany({
      where: {
        status: WidgetArticleStatus.PUBLISHED,
        widgetInstallationId: {
          in: installations.map((item) => item.installationId),
        },
      },
      select: {
        widgetInstallationId: true,
        slug: true,
        publishedAt: true,
        updatedAt: true,
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    });

    const byInstallation = new Map<string, typeof articles>();
    for (const article of articles) {
      const current = byInstallation.get(article.widgetInstallationId) ?? [];
      current.push(article);
      byInstallation.set(article.widgetInstallationId, current);
    }

    return {
      portals: installations.map((item) => ({
        companySlug: item.companySlug,
        updatedAt: item.installationUpdatedAt,
        articles: (byInstallation.get(item.installationId) ?? []).map((article) => ({
          slug: article.slug,
          publishedAt: article.publishedAt,
          updatedAt: article.updatedAt,
        })),
      })),
    };
  }

  static async answerPublicHelpCenterQuestionByCompanySlug(
    companySlug: string,
    question: string
  ) {
    const installation = await this.resolvePublicPortalInstallation(companySlug);

    const normalizedQuestion = normalizeQuestionText(question);
    const tokens = tokenizeQuestion(normalizedQuestion);

    const baseWhere = {
      companyId: installation.companyId,
      widgetInstallationId: installation.id,
      status: WidgetArticleStatus.PUBLISHED,
    } satisfies Prisma.WidgetArticleWhereInput;

    const publishedCount = await prisma.widgetArticle.count({
      where: baseWhere,
    });

    if (publishedCount === 0) {
      return {
        publicKey: installation.publicKey,
        question: normalizedQuestion,
        state: "EMPTY" as const,
        message:
          "No published help articles are available yet. Please check back later.",
        answer: null,
        suggestions: [],
      };
    }

    const candidates = await prisma.widgetArticle.findMany({
      where: {
        ...baseWhere,
        OR: [
          {
            title: {
              contains: normalizedQuestion,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            summary: {
              contains: normalizedQuestion,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            content: {
              contains: normalizedQuestion,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          ...tokens.flatMap((token) => [
            {
              title: {
                contains: token,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              summary: {
                contains: token,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              content: {
                contains: token,
                mode: Prisma.QueryMode.insensitive,
              },
            },
          ]),
        ],
      },
      include: {
        category: true,
      },
      orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }, { id: "desc" }],
      take: 30,
    });

    if (candidates.length === 0) {
      return {
        publicKey: installation.publicKey,
        question: normalizedQuestion,
        state: "NO_MATCH" as const,
        message:
          "No matching answer found. Try rephrasing your question or browsing Help Centre articles.",
        answer: null,
        suggestions: [],
      };
    }

    const questionLc = normalizedQuestion.toLowerCase();
    const scored = candidates
      .map((article) => {
        const title = article.title.toLowerCase();
        const summary = article.summary.toLowerCase();
        const content = article.content.toLowerCase();

        let score = 0;

        if (title.includes(questionLc)) score += 120;
        if (summary.includes(questionLc)) score += 80;
        if (content.includes(questionLc)) score += 40;

        for (const token of tokens) {
          if (title.includes(token)) score += 16;
          if (summary.includes(token)) score += 10;
          if (content.includes(token)) score += 5;
        }

        const excerptSource = article.content.trim() || article.summary.trim();
        const excerpt =
          excerptSource.length > 280
            ? `${excerptSource.slice(0, 277)}...`
            : excerptSource;

        return {
          score,
          article: mapPublicWidgetArticle(article),
          excerpt,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, PUBLIC_ANSWER_LIMIT);

    const [best, ...suggestions] = scored;

    return {
      publicKey: installation.publicKey,
      question: normalizedQuestion,
      state: "ANSWERED" as const,
      message: "Found matching help article answers.",
      answer: best
        ? {
            article: best.article,
            excerpt: best.excerpt,
          }
        : null,
      suggestions: suggestions.map((item) => ({
        article: item.article,
        excerpt: item.excerpt,
      })),
    };
  }

  // ===== Private helpers =====

  private static async resolveOwnedInstallation(
    companyId: string,
    installationId: string
  ) {
    const installation = await prisma.widgetInstallation.findFirst({
      where: { id: installationId, companyId },
    });
    if (!installation) {
      throw new AppError("Widget installation not found", HTTP_STATUS.NOT_FOUND);
    }
    return installation;
  }

  private static async resolveOwnedFaqEntry(
    companyId: string,
    installationId: string,
    faqId: string
  ) {
    const entry = await prisma.widgetFaqEntry.findFirst({
      where: { id: faqId, widgetInstallationId: installationId, companyId },
    });
    if (!entry) {
      throw new AppError("FAQ entry not found", HTTP_STATUS.NOT_FOUND);
    }
    return entry;
  }

  private static async resolveOwnedArticleCategory(
    companyId: string,
    installationId: string,
    categoryId: string,
    withCount = false
  ) {
    const category = await prisma.widgetArticleCategory.findFirst({
      where: {
        id: categoryId,
        companyId,
        widgetInstallationId: installationId,
      },
      ...(withCount
        ? {
            include: {
              _count: {
                select: {
                  articles: true,
                },
              },
            },
          }
        : {}),
    });

    if (!category) {
      throw new AppError("Category not found", HTTP_STATUS.NOT_FOUND);
    }

    return category;
  }

  private static async resolveOwnedArticle(
    companyId: string,
    installationId: string,
    articleId: string,
    includeRelations = false
  ) {
    const article = await prisma.widgetArticle.findFirst({
      where: {
        id: articleId,
        companyId,
        widgetInstallationId: installationId,
      },
      ...(includeRelations ? { include: widgetArticleInclude } : {}),
    });

    if (!article) {
      throw new AppError("Article not found", HTTP_STATUS.NOT_FOUND);
    }

    return article;
  }

  private static async assertValidCategory(
    companyId: string,
    installationId: string,
    categoryId: string | null | undefined
  ) {
    if (categoryId === undefined) {
      return;
    }

    if (categoryId === null) {
      return;
    }

    await this.resolveOwnedArticleCategory(companyId, installationId, categoryId);
  }

  private static throwIfDuplicateSlug(error: unknown, message: string): never | void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(message, HTTP_STATUS.CONFLICT);
    }
  }

  // ===== Branding uploads (admin) =====

  static async uploadBrandingImage(
    companyId: string,
    installationId: string,
    field: "logoUrl" | "heroImageUrl",
    file: Express.Multer.File
  ) {
    await this.resolveOwnedInstallation(companyId, installationId);
    validateBrandingFileSecurity(file);

    // Delete previous image from storage if exists
    const current = await prisma.widgetInstallation.findUnique({
      where: { id: installationId },
      select: { logoUrl: true, heroImageUrl: true },
    });
    const prevKey = field === "logoUrl" ? current?.logoUrl : current?.heroImageUrl;
    if (prevKey) {
      // Extract storage key from stored path  
      const existingKey = prevKey.split("/").pop();
      if (existingKey) await attachmentStorage.remove(existingKey).catch(() => undefined);
    }

    const storageKey = await attachmentStorage.save(file.buffer);
    const url = `/api/v1/widget/branding/${storageKey}`;

    const updated = await prisma.widgetInstallation.update({
      where: { id: installationId },
      data: { [field]: url },
    });

    return mapWidgetInstallation(updated);
  }

  static async removeBrandingImage(
    companyId: string,
    installationId: string,
    field: "logoUrl" | "heroImageUrl"
  ) {
    await this.resolveOwnedInstallation(companyId, installationId);

    const current = await prisma.widgetInstallation.findUnique({
      where: { id: installationId },
      select: { logoUrl: true, heroImageUrl: true },
    });
    const prevKey = field === "logoUrl" ? current?.logoUrl : current?.heroImageUrl;
    if (prevKey) {
      const existingKey = prevKey.split("/").pop();
      if (existingKey) await attachmentStorage.remove(existingKey).catch(() => undefined);
    }

    const updated = await prisma.widgetInstallation.update({
      where: { id: installationId },
      data: { [field]: null },
    });

    return mapWidgetInstallation(updated);
  }

  static async serveBrandingImage(storageKey: string): Promise<{ buffer: Buffer; mimeType: string }> {
    // Validate key is a UUID (no path traversal)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(storageKey)) {
      throw new AppError("Branding asset not found", HTTP_STATUS.NOT_FOUND);
    }

    let buffer: Buffer;
    try {
      buffer = await attachmentStorage.read(storageKey);
    } catch {
      throw new AppError("Branding asset not found", HTTP_STATUS.NOT_FOUND);
    }

    // Detect MIME type from magic bytes
    const mimeType = detectImageMimeType(buffer);
    if (!mimeType) {
      throw new AppError("Branding asset not found", HTTP_STATUS.NOT_FOUND);
    }

    return { buffer, mimeType };
  }
}

function detectImageMimeType(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  // JPEG: ff d8 ff
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4e 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return "image/webp";
  return null;
}
