import crypto from "node:crypto";
import {
  ConversationChannel,
  MessageSender,
  Prisma,
  TicketActivityAction,
  TicketPriority,
  TicketStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { getIO } from "@/socket/socket.server.js";
import type {
  CreateWidgetConversationInput,
  CreateWidgetInstallationInput,
  CreateWidgetMessageInput,
  UpdateWidgetInstallationInput,
  WidgetMessagesQueryInput,
  CreateWidgetFaqEntryInput,
  UpdateWidgetFaqEntryInput,
} from "./widget.validation.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import {
  mapWidgetBootstrap,
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

type RequestOrigin = string | undefined;

const WIDGET_ACCESS_ERROR = "Widget is not available";
const WIDGET_MESSAGE_WINDOW_MS = 30 * 1000;
const WIDGET_MESSAGE_WINDOW_MAX = 5;

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

    const result = await prisma.$transaction(async (tx) => {
      const existingCustomer = data.visitorEmail
        ? await tx.customer.findFirst({
            where: {
              companyId: installation.companyId,
              email: data.visitorEmail,
            },
          })
        : null;

      const customer = existingCustomer
        ? await tx.customer.update({
            where: {
              id: existingCustomer.id,
            },
            data: {
              firstName: data.visitorName,
            },
          })
        : await tx.customer.create({
            data: {
              companyId: installation.companyId,
              firstName: data.visitorName,
              email: data.visitorEmail,
            },
          });

      const conversation = await tx.conversation.create({
        data: {
          companyId: installation.companyId,
          customerId: customer.id,
          channel: ConversationChannel.WEBSITE,
        },
      });

      const message = await tx.message.create({
        data: {
          companyId: installation.companyId,
          conversationId: conversation.id,
          sender: MessageSender.CUSTOMER,
          content: data.initialMessage,
        },
      });

      const ticket = await this.createOrTouchWidgetTicket(tx, {
        companyId: installation.companyId,
        customerId: customer.id,
        conversationId: conversation.id,
        messageContent: data.initialMessage,
        mode: "create",
      });

      return {
        customer,
        conversation,
        message,
        ticket,
      };
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
      mode: "create" | "message";
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

    const actor = await tx.user.findFirst({
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
    });

    if (!actor) {
      throw new AppError(
        "Widget ticket automation is not configured",
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      );
    }

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
          actorId: actor.id,
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

    const slaPolicy = await tx.slaPolicy.findFirst({
      where: {
        companyId: input.companyId,
        priority: TicketPriority.MEDIUM,
        enabled: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
    const createdAt = new Date();
    const createdTicket = await tx.ticket.create({
      data: {
        companyId: input.companyId,
        customerId: input.customerId,
        conversationId: input.conversationId,
        createdById: actor.id,
        subject: deriveTicketSubject(input.messageContent),
        description: input.messageContent,
        status: TicketStatus.OPEN,
        priority: TicketPriority.MEDIUM,
        ...(slaPolicy
          ? {
              firstResponseDueAt: new Date(
                createdAt.getTime() + slaPolicy.firstResponseMinutes * 60_000
              ),
              resolutionDueAt: new Date(
                createdAt.getTime() + slaPolicy.resolutionMinutes * 60_000
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
        actorId: actor.id,
        action: TicketActivityAction.TICKET_CREATED_FROM_WIDGET,
        metadata: {
          source: "widget",
          channel: ConversationChannel.WEBSITE,
          conversationId: input.conversationId,
          customerId: input.customerId,
          priority: TicketPriority.MEDIUM,
          trigger: input.mode,
        },
      },
    });

    return {
      ticket: createdTicket,
      created: true,
    };
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
