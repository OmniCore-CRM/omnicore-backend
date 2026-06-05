import type {
  Conversation,
  ConversationTag,
  Customer,
  Message,
  Tag,
} from "@prisma/client";

// Conversation payload with related entities
type ConversationWithRelations = Conversation & {
  customer: Customer;
  messages?: Message[];
  tags?: (ConversationTag & { tag: Tag })[];
};

const mapTag = (tag: Tag) => ({
  id: tag.id,
  companyId: tag.companyId,
  name: tag.name,
  color: tag.color,
  createdAt: tag.createdAt,
  updatedAt: tag.updatedAt,
});

// Normalize single conversation response
export const mapConversation = (
  conversation: ConversationWithRelations
) => {
  return {
    id: conversation.id,
    companyId: conversation.companyId,
    customerId: conversation.customerId,

    channel: conversation.channel,

    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,

    customer: {
      id: conversation.customer.id,
      firstName: conversation.customer.firstName,
      lastName: conversation.customer.lastName,
      email: conversation.customer.email,
      phone: conversation.customer.phone,
    },

    messages: conversation.messages?.map((message) => ({
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
    })) ?? [],
    tags: conversation.tags?.map((link) => mapTag(link.tag)) ?? [],
  };
};

// Normalize multiple conversations response
export const mapConversations = (
  conversations: ConversationWithRelations[]
) => {
  return conversations.map(mapConversation);
};
