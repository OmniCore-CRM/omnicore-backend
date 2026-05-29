import { ConversationChannel, MessageSender } from "@prisma/client";
import { prisma } from "@/config/db.js";
import { getIO } from "@/socket/socket.server.js";
import type { CreateWidgetConversationInput, CreateWidgetMessageInput } from "./widget.validation.js";
import { resolveDevelopmentIngestionCompanyId } from "@/core/utils/tenant-resolution.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { mapMessage } from "@/modules/messages/message.mapper.js";
import { mapConversation } from "@/modules/conversations/conversation.mapper.js";
import { mapCustomer } from "@/modules/customers/customer.mapper.js";

export class WidgetService {
  // ===== Create public widget conversation =====
  static async createWidgetConversation(
    data: CreateWidgetConversationInput
  ) {
    const companyId = resolveDevelopmentIngestionCompanyId();

    // Create customer + conversation + message atomically
    const result = await prisma.$transaction(
      async (tx) => {
        // Create customer
        const customer = await tx.customer.create({
          data: {
            companyId,

            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
          },
        });

        // Create website conversation
        const conversation = await tx.conversation.create({
          data: {
            companyId,
            customerId: customer.id,
            channel: ConversationChannel.WEBSITE,
          },
        });

        // Create initial customer message
        const message = await tx.message.create({
          data: {
            companyId,
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
      }
    );

    // Emit realtime message event
    const io = getIO();

    io.to(
      `conversation:${result.conversation.id}`
    ).emit("new_message", mapMessage(result.message));

    // Notify agent inbox about new conversation
    io.to(`company:${companyId}`).emit(
      "new_conversation",
      mapConversation({
        ...result.conversation,
        customer: result.customer,
        messages: [result.message],
      })
    );

    return {
      customer: mapCustomer(result.customer),
      conversation: mapConversation({
        ...result.conversation,
        customer: result.customer,
        messages: [result.message],
      }),
      message: mapMessage(result.message),
    };
  }

  // ===== Send public widget message =====
  static async createWidgetMessage(data: CreateWidgetMessageInput) {
    const companyId = resolveDevelopmentIngestionCompanyId();

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: data.conversationId,
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

    // Create message + update conversation atomically
    const message = await prisma.$transaction(
      async (tx) => {
        // Create customer message
        const createdMessage = await tx.message.create({
          data: {
            companyId,
            conversationId: data.conversationId,
            sender: MessageSender.CUSTOMER,
            content: data.content,
          },
        });

        // Update conversation activity
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

    // Emit realtime message
    const io = getIO();

    io.to(
      `conversation:${data.conversationId}`
    ).emit("new_message", mapMessage(message));

    return mapMessage(message);
  }
}
