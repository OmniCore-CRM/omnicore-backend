import { prisma } from "@/config/db.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import type { CreateMessageInput } from "./message.validation.js";
import { getIO } from "@/socket/socket.server.js";
import { ChannelService } from "../channels/channel.service.js";
import { mapMessage, mapMessages } from "./message.mapper.js";

export class MessageService {
  // ===== Create tenant-scoped message =====
  static async createMessage(
    companyId: string,
    data: CreateMessageInput
  ) {
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

        // Emit realtime message event
        const io = getIO();

        io.to(
          `conversation:${data.conversationId}`
        ).emit("new_message", mapMessage(createdMessage));

        return createdMessage;
      }
    );

    // Route outbound message through connected provider
    if (conversation.channel === "WHATSAPP") {
      await ChannelService.sendOutboundMessage({
        messageId: message.id,
        conversationId: conversation.id,
        content: data.content,
      });
    }

    return mapMessage(message);
  }

  // ===== Fetch messages belonging to tenant conversation =====
  static async getConversationMessages(
    companyId: string,
    conversationId: string
  ) {
    // Ensure conversation belongs to authenticated tenant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        companyId,
      },
    });

    // Prevent foreign tenant message access
    if (!conversation) {
      throw new AppError(
        "Conversation not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    // Fetch ordered conversation messages
    const messages = await prisma.message.findMany({
      where: {
        companyId,
        conversationId,
      },

      orderBy: {
        createdAt: "asc",
      },
    });

    return mapMessages(messages);
  }
}
