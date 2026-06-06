import type { Attachment, Message, User } from "@prisma/client";
import { mapAttachments } from "@/modules/attachments/attachment.mapper.js";

type MessageWithAttachments = Message & {
  attachments?: (Attachment & { uploadedBy?: User | null })[];
};

// Normalize single message response
export const mapMessage = (
  message: MessageWithAttachments
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
    attachments: mapAttachments(message.attachments ?? []),

    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
};

// Normalize multiple messages response
export const mapMessages = (
  messages: MessageWithAttachments[]
) => {
  return messages.map(mapMessage);
};
