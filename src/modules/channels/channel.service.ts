import type { IncomingChannelMessage, ChannelDeliveryEvent } from "./channel.types.js";
import { ConversationChannel, MessageSender, MessageStatus, Prisma } from "@prisma/client";
import { prisma } from "@/config/db.js";
import { getIO } from "@/socket/socket.server.js";
import axios from "axios";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { mapMessage } from "@/modules/messages/message.mapper.js";
import { mapConversation } from "@/modules/conversations/conversation.mapper.js";
import { env } from "@/config/env.js";
import { resolveWhatsAppIngestionCompanyId } from "@/core/utils/tenant-resolution.js";
import { AssignmentRuleService } from "@/modules/assignment-rules/assignment-rule.service.js";
import { EmailService } from "@/modules/email/email.service.js";

const WHATSAPP_SEND_FAILED_MESSAGE =
  "WhatsApp message failed. The recipient may be invalid, not allowed for this test number, or outside the messaging window.";

type SafeProviderFailure = {
  provider: "WHATSAPP";
  reason: "PROVIDER_REJECTED" | "PROVIDER_UNAVAILABLE";
  providerStatus?: number;
  providerCode?: string | number;
  providerType?: string;
  fbtraceId?: string;
};

const normalizeWhatsAppProviderFailure = (
  error: unknown
): SafeProviderFailure => {
  if (!axios.isAxiosError(error)) {
    return {
      provider: "WHATSAPP",
      reason: "PROVIDER_UNAVAILABLE",
    };
  }

  const responseData = error.response?.data as
    | {
        error?: {
          code?: string | number;
          type?: string;
          fbtrace_id?: string;
        };
      }
    | undefined;

  return {
    provider: "WHATSAPP",
    reason: "PROVIDER_REJECTED",
    providerStatus: error.response?.status,
    providerCode: responseData?.error?.code,
    providerType: responseData?.error?.type,
    fbtraceId: responseData?.error?.fbtrace_id,
  };
};

const logWhatsAppProviderFailure = (
  context: {
    companyId: string;
    conversationId: string;
    messageId: string;
  },
  failure: SafeProviderFailure
) => {
  console.error("WhatsApp provider send failed", {
    ...context,
    ...failure,
  });
};

const messageStatusRank: Record<MessageStatus, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
};

const emitMessageStatusUpdated = (message: Awaited<ReturnType<typeof prisma.message.update>>) => {
  const io = getIO();

  io.to(`conversation:${message.conversationId}`).emit(
    "message_status_updated",
    mapMessage(message)
  );
};

export class ChannelService {
  // ===== Process inbound provider message =====
  static async processIncomingMessage(payload: IncomingChannelMessage) {
    const companyId = await resolveWhatsAppIngestionCompanyId(payload.providerAccountId);

    const existingMessage = await prisma.message.findFirst({
      where: {
        companyId,
        provider: ConversationChannel.WHATSAPP,
        externalMessageId: payload.externalMessageId,
      },
    });

    if (existingMessage) {
      return;
    }

    // Track whether conversation was newly created
    let isNewConversation = false;

    // Process CRM flow atomically
    const result = await prisma.$transaction(async (tx) => {
      // Find existing customer by phone
      let customer =
        await tx.customer.findFirst({
          where: {
            companyId,

            phone:
              payload.customerPhone || payload.externalUserId,
          },
        });

      // Create customer if not found
      if (!customer) {
        customer =
          await tx.customer.create({
            data: {
              companyId,

              firstName:
                payload.customerName ||
                "Unknown",

              lastName: "Customer",

              phone:
                payload.customerPhone ||
                payload.externalUserId,
            },
          });
      }

      // Find existing conversation
      let conversation =
        await tx.conversation.findFirst({
          where: {
            companyId,

            customerId:
              customer.id,

            channel:
              ConversationChannel.WHATSAPP,
          },
        });

      // Create conversation if not found
      if (!conversation) {
        conversation =
          await tx.conversation.create({
            data: {
              companyId,

              customerId:
                customer.id,

              channel:
                ConversationChannel.WHATSAPP,
            },
          });

        isNewConversation = true;
      }

      // Create CRM message
      const message =
        await tx.message.create({
          data: {
            companyId,
            conversationId: conversation.id,
            sender: MessageSender.CUSTOMER,
            content: payload.content,
            status: MessageStatus.DELIVERED,
            externalMessageId: payload.externalMessageId,
            provider: ConversationChannel.WHATSAPP,
          },
        });

      // Update conversation activity timestamp
      await tx.conversation.update({
        where: {
          id: conversation.id,
        },

        data: {
          updatedAt: new Date(),
        },
      });

      return {
        customer,
        conversation,
        message,
      };
    }).catch(async (error) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const duplicate = await prisma.message.findFirst({
          where: {
            companyId,
            provider: ConversationChannel.WHATSAPP,
            externalMessageId: payload.externalMessageId,
          },
          include: { conversation: true },
        });

        return duplicate
          ? { customer: null, conversation: duplicate.conversation, message: duplicate }
          : null;
      }

      throw error;
    });

    if (!result || !result.customer) {
      return;
    }

    // Emit realtime inbox update
    const io = getIO();

    io.to(
      `conversation:${result.conversation.id}`
    ).emit("new_message", mapMessage(result.message));

    // Emit new conversation event only for newly created conversations
    if (isNewConversation) {
      const conversationWithRelations = {
        ...result.conversation,
        customer: result.customer,
        messages: [result.message],
      };
      io.to(`company:${companyId}`).emit(
        "new_conversation",
        mapConversation(conversationWithRelations)
      );
      await AssignmentRuleService.applyConversationRules({
        companyId,
        conversationId: result.conversation.id,
        channel: result.conversation.channel,
      });
    }
  }

  // ===== Process delivery/read events =====
  static async processDeliveryEvent(payload: ChannelDeliveryEvent) {
    const companyId = await resolveWhatsAppIngestionCompanyId(payload.providerAccountId);

    // Find CRM message by provider message ID
    const message = await prisma.message.findFirst({
      where: {
        companyId,
        provider: ConversationChannel.WHATSAPP,
        externalMessageId: payload.externalMessageId,
      },
    });

    // Message may not exist yet
    if (!message) {
      return;
    }

    if (
      messageStatusRank[payload.status] <
      messageStatusRank[message.status]
    ) {
      return;
    }

    // Update CRM message status
    const updatedMessage = await prisma.message.update({
      where: {
        id: message.id,
      },

      data: {
        status: payload.status,
      },
    });

    emitMessageStatusUpdated(updatedMessage);
  }

  // ===== Send outbound provider message =====
  static async sendOutboundMessage({ messageId, conversationId, content, }: {
    messageId: string;
    conversationId: string;
    content: string;
  }) {
    // Find CRM conversation
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },

      include: {
        customer: true,
      },
    });

    // Conversation not found
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    // Determine provider channel
    switch (conversation.channel) {
      case ConversationChannel.WHATSAPP:
        return await this.sendWhatsAppMessage({
          companyId: conversation.companyId,
          messageId,
          conversationId,
          customerPhone: conversation.customer.phone || "",
          content,
        });

      case ConversationChannel.EMAIL:
        return await EmailService.sendOutboundMessage({
          companyId: conversation.companyId,
          messageId,
          conversationId,
          customerEmail: conversation.customer.email || "",
          subject: conversation.subject,
          content,
        });

      default:
        throw new Error("Unsupported provider channel");
    }
  }

  // ===== Send WhatsApp message =====
  static async sendWhatsAppMessage({
    companyId,
    messageId,
    conversationId,
    customerPhone,
    content,
  }: {
    companyId: string
    messageId: string;
    conversationId: string;
    customerPhone: string;
    content: string;
  }) {
    if (
      !env.WHATSAPP_PHONE_NUMBER_ID ||
      !env.WHATSAPP_ACCESS_TOKEN
    ) {
      const failedMessage = await prisma.message.update({
        where: {
          id: messageId,
        },
        data: {
          status: MessageStatus.FAILED,
          provider: ConversationChannel.WHATSAPP,
        },
      });

      emitMessageStatusUpdated(failedMessage);

      throw new AppError(
        "WhatsApp provider is not configured",
        HTTP_STATUS.BAD_GATEWAY,
        {
          code: "WHATSAPP_PROVIDER_NOT_CONFIGURED",
          details: {
            provider: "WHATSAPP",
          },
        }
      );
    }

    // Send outbound message through Meta WhatsApp Cloud API
    let externalMessageId: string;

    try {
      const response = await axios.post(
        `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: customerPhone,
          type: "text",
          text: {
            body: content,
          },
        },

        {
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      // Extract provider-generated WhatsApp message ID
      externalMessageId = response.data.messages?.[0]?.id;

      // Meta API returned unexpected response shape
      if (!externalMessageId) {
        throw new AppError(
          "WhatsApp provider did not return message ID",
          HTTP_STATUS.BAD_GATEWAY
        );
      }
    } catch (error) {
      // Normalize provider-specific API failures
      if (axios.isAxiosError(error)) {
        const failure = normalizeWhatsAppProviderFailure(error);

        const failedMessage = await prisma.message.update({
          where: {
            id: messageId,
          },
          data: {
            status: MessageStatus.FAILED,
            provider: ConversationChannel.WHATSAPP,
          },
        });

        emitMessageStatusUpdated(failedMessage);

        logWhatsAppProviderFailure(
          {
            companyId,
            conversationId,
            messageId,
          },
          failure
        );

        throw new AppError(
          WHATSAPP_SEND_FAILED_MESSAGE,
          HTTP_STATUS.BAD_GATEWAY,
          {
            code: "WHATSAPP_SEND_FAILED",
            details: failure,
          }
        );
      }

      throw error;
    }

    const message = await prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        status: MessageStatus.SENT,
        externalMessageId,
        provider: ConversationChannel.WHATSAPP,
      },
    });

    // Emit realtime inbox update
    emitMessageStatusUpdated(message);

    return message;
  }
}
