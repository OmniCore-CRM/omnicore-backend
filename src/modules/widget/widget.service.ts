import crypto from "node:crypto";
import { ConversationChannel, MessageSender } from "@prisma/client";
import { prisma } from "@/config/db.js";
import { getIO } from "@/socket/socket.server.js";
import type {
  CreateWidgetConversationInput,
  CreateWidgetInstallationInput,
  CreateWidgetMessageInput,
  UpdateWidgetInstallationInput,
  WidgetMessagesQueryInput,
} from "./widget.validation.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import {
  mapWidgetBootstrap,
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

type RequestOrigin = string | undefined;

const WIDGET_ACCESS_ERROR = "Widget is not available";

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
    data: CreateWidgetInstallationInput
  ) {
    const installation = await prisma.widgetInstallation.create({
      data: {
        companyId,
        publicKey: createPublicKey(),
        allowedDomains: normalizeAllowedDomains(data.allowedDomains),
      },
    });

    return mapWidgetInstallation(installation);
  }

  static async updateInstallation(
    companyId: string,
    installationId: string,
    data: UpdateWidgetInstallationInput
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
      },
    });

    return mapWidgetInstallation(updated);
  }

  static async bootstrap(publicKey: string, requestOrigin: RequestOrigin) {
    const installation = await this.resolveEnabledInstallation(
      publicKey,
      requestOrigin
    );

    return mapWidgetBootstrap(installation);
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

      return {
        customer,
        conversation,
        message,
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

    return {
      ...page,
      items: mapPublicWidgetMessages(page.items),
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

    const message = await prisma.$transaction(async (tx) => {
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

      return createdMessage;
    });

    const messageDto = mapPublicWidgetMessage(message);
    const io = getIO();

    io.to(`company:${session.companyId}`).emit(
      "new_message",
      messageDto
    );
    io.to(`conversation:${conversationId}`).emit(
      "new_message",
      messageDto
    );

    return messageDto;
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
}
