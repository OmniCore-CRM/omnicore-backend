import { MessageStatus, Prisma } from "@prisma/client";
import { prisma } from "@/config/db.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import type { CreateMessageInput } from "./message.validation.js";
import { getIO } from "@/socket/socket.server.js";
import { ChannelService } from "../channels/channel.service.js";
import { mapMessage, mapMessages } from "./message.mapper.js";
import type { PaginationParams } from "@/core/utils/pagination.js";
import { toPaginatedResult } from "@/core/utils/pagination.js";
import { TicketSlaService } from "@/modules/sla-policies/ticket-sla.service.js";
import { NotificationService } from "@/modules/notifications/notification.service.js";
import { NotificationType } from "@prisma/client";

const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

export class MessageService {
  // ===== Create tenant-scoped message =====
  static async createMessage(
    user: { companyId: string; userId: string },
    data: CreateMessageInput
  ) {
    const companyId = user.companyId;
    // Ensure conversation belongs to authenticated tenant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: data.conversationId,
        companyId,
      },
    });

    // Prevent foreign tenant message creation
    if (!conversation) {
      throw new AppError(
        "Conversation not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    // Ensure conversation has connected customer
    const customer = await prisma.customer.findFirst({
      where: {
        id: conversation.customerId,
        companyId,
      },
    });

    if (!customer) {
      throw new AppError(
        "Customer not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    // Create message + update conversation atomically
    const message = await prisma.$transaction(
      async (tx) => {
        // Create tenant-scoped message
        const createdMessage = await tx.message.create({
          data: {
            companyId,
            conversationId: data.conversationId,
            sender: data.sender,
            content: data.content,
            status:
              (conversation.channel === "WHATSAPP" ||
                conversation.channel === "EMAIL") &&
              data.sender === "AGENT"
                ? MessageStatus.PENDING
                : MessageStatus.SENT,
            provider:
              conversation.channel === "WHATSAPP" ||
              conversation.channel === "EMAIL"
                ? conversation.channel
                : null,
          },
        });

        // Update conversation activity timestamp
        await tx.conversation.update({
          where: {
            id: data.conversationId,
          },

          data: {
            updatedAt: new Date(),
          },
        });

        return createdMessage;
      }
    );

    const io = getIO();

    io.to(
      `conversation:${data.conversationId}`
    ).emit("new_message", mapMessage(message));

    if (data.sender === "AGENT") {
      try {
        await TicketSlaService.recordFirstResponse(
          companyId,
          data.conversationId,
          user.userId
        );
      } catch {
        console.error(
          JSON.stringify({
            level: "error",
            event: "ticket_sla_first_response_update_failed",
            companyId,
            conversationId: data.conversationId,
          })
        );
      }
    }

    if (data.sender === "AGENT") {
      await NotificationService.notifyMentionsFromText(data.content, {
        companyId,
        actorId: user.userId,
        type: NotificationType.CONVERSATION_MENTION,
        title: "You were mentioned in a conversation",
        message: "A teammate mentioned you in a conversation message.",
        entityType: "CONVERSATION",
        entityId: data.conversationId,
        metadata: {
          route: `/inbox?c=${data.conversationId}`,
          messageId: message.id,
        },
      });
    }

    // Route outbound message through connected provider
    if (
      data.sender === "AGENT" &&
      (conversation.channel === "WHATSAPP" ||
        conversation.channel === "EMAIL")
    ) {
      const providerMessage = await ChannelService.retryOutboundMessage({
        companyId,
        messageId: message.id,
        force: true,
      });

      if (!providerMessage) {
        const fallback = await prisma.message.findUnique({ where: { id: message.id } });
        return mapMessage(fallback ?? message);
      }

      return mapMessage(providerMessage);
    }

    return mapMessage(message);
  }

  // ===== Fetch messages belonging to tenant conversation =====
  static async getConversationMessages(
    companyId: string,
    conversationId: string,
    params: PaginationParams
  ) {
    // Fetch ordered conversation messages
    const messages = await prisma.message.findMany({
      where: {
        companyId,
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

      take: params.limit + 1,
      ...(params.cursor
        ? {
            cursor: {
              id: params.cursor,
            },
            skip: 1,
          }
        : {}),
    });

    if (messages.length === 0) {
      // Preserve 404 semantics when the conversation does not belong to tenant.
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          companyId,
        },
        select: {
          id: true,
        },
      });

      if (!conversation) {
        throw new AppError(
          "Conversation not found",
          HTTP_STATUS.NOT_FOUND
        );
      }
    }

    const page = toPaginatedResult(messages, params.limit);

    return {
      ...page,
      items: mapMessages(page.items),
    };
  }
}
