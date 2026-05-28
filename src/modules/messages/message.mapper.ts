import type { Message } from "@prisma/client";

// Normalize single message response
export const mapMessage = (
  message: Message
) => {
  return {
    id: message.id,

    companyId: message.companyId,
    conversationId: message.conversationId,

    sender: message.sender,
    content: message.content,
    status: message.status,

    provider: message.provider,
    externalMessageId: message.externalMessageId,

    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
};

// Normalize multiple messages response
export const mapMessages = (
  messages: Message[]
) => {
  return messages.map(mapMessage);
};