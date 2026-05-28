import { ConversationChannel, MessageSender } from "@prisma/client";
import { prisma } from "@/config/db.js";
import { getIO } from "@/socket/socket.server.js";
import type { CreateWidgetConversationInput, CreateWidgetMessageInput } from "./widget.validation.js";
import { DEFAULT_COMPANY_ID } from "@/core/constants/app.constants.js";

export class WidgetService {
  // ===== Create public widget conversation =====
  static async createWidgetConversation(
    data: CreateWidgetConversationInput
  ) {
    // TODO
    // Later this will come from:
    // - widget token
    // - domain config
    // - tenant mapping

    // Temporary hardcoded tenant for MVP
    const companyId = DEFAULT_COMPANY_ID;

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
    ).emit("new_message", result.message);

    // Notify agent inbox about new conversation
    io.emit(
      "new_conversation",
      result.conversation
    );

    return result;
  }

  // ===== Send public widget message =====
  static async createWidgetMessage(data: CreateWidgetMessageInput) {
    // Temporary hardcoded tenant for MVP
    const companyId = "cmp0akvyj0000woqughybpvfb";

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
    ).emit("new_message", message);

    return message;
  }
}