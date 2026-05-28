import type { IncomingChannelMessage, ChannelDeliveryEvent } from "./channel.types.js";
import { ConversationChannel, MessageSender, MessageStatus } from "@prisma/client";
import { prisma } from "@/config/db.js";
import { getIO } from "@/socket/socket.server.js";
import { DEFAULT_COMPANY_ID } from "@/core/constants/app.constants.js";
import axios from "axios";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { mapMessage } from "@/modules/messages/message.mapper.js";
import { mapConversation } from "@/modules/conversations/conversation.mapper.js";

export class ChannelService {
  // ===== Process inbound provider message =====
  static async processIncomingMessage(payload: IncomingChannelMessage) {
    console.log("Normalized incoming message:");
    console.log(payload);
    
    // Temporary hardcoded tenant
    const companyId = DEFAULT_COMPANY_ID;

    // Track whether conversation was newly created
    let isNewConversation = false;

    // Process CRM flow atomically
    const result = await prisma.$transaction(
      async (tx) => {
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
      }
    );

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
    }
  }

  // ===== Process delivery/read events =====
  static async processDeliveryEvent(payload: ChannelDeliveryEvent) {
    console.log("Normalized delivery event:");
    console.log(payload);
    
  //  Find CRM message by provider message ID
  const message = await prisma.message.findFirst({
    where: {
      externalMessageId: payload.externalMessageId,
    },
  });

  // Message may not exist yet
  if (!message) {
    console.log("No CRM message found for delivery event");
    
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

  // Emit realtime delivery update
  const io = getIO();

  io.to(`conversation:${message.conversationId}`).emit(
    "message_status_updated",
    mapMessage(updatedMessage)
  );
  }

  // ===== Send outbound provider message =====
  static async sendOutboundMessage({ conversationId, content, }: {
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
          conversationId,
          customerPhone: conversation.customer.phone || "",
          content,
        });

      default:
        throw new Error("Unsupported provider channel");
    }
  }

  // ===== Send WhatsApp message =====
  static async sendWhatsAppMessage({
    companyId,
    conversationId,
    customerPhone,
    content,
  }: {
    companyId: string
    conversationId: string;
    customerPhone: string;
    content: string;
  }) {
    console.log("Sending WhatsApp message...");
    console.log({
      conversationId,
      customerPhone,
      content,
    });
    
    // TODO
    // Real Meta WhatsApp API call
    // Persist outbound provider IDs
    // Handle provider failures

    // Send outbound message through Meta WhatsApp Cloud API
    let externalMessageId: string;

    try {
      const response = await axios.post(
        `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
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
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
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
        console.error(
          "WhatsApp provider error:",
          error.response?.data
        );

        throw new AppError(
          "WhatsApp provider rejected outbound message",
          HTTP_STATUS.BAD_GATEWAY
        );
      }

      throw error;
    }

    // Create outbound CRM message
    const message = await prisma.message.create({
      data: {
        companyId,
        conversationId,
        sender: MessageSender.AGENT,
        content,
        status: MessageStatus.SENT,
        externalMessageId,
        provider: ConversationChannel.WHATSAPP,
      },
    });

    // Emit realtime inbox update
    const io = getIO();

    io.to(`conversation:${conversationId}`).emit("new_message", mapMessage(message));

    return message;
  }
}