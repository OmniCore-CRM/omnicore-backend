import type {
  Conversation,
  ConversationActivity,
  ConversationTag,
  Customer,
  Message,
  Tag,
  Team,
  User,
  Attachment,
} from "@prisma/client";
import { mapAttachments } from "@/modules/attachments/attachment.mapper.js";

// Conversation payload with related entities
type ConversationWithRelations = Conversation & {
  customer: Customer;
  messages?: (Message & {
    attachments?: (Attachment & { uploadedBy?: User | null })[];
  })[];
  attachments?: (Attachment & { uploadedBy?: User | null })[];
  tags?: (ConversationTag & { tag: Tag })[];
  activities?: ConversationActivityWithActor[];
  team?: Team | null;
};

type ConversationActivityWithActor = ConversationActivity & {
  actor: User;
};

const mapTag = (tag: Tag) => ({
  id: tag.id,
  companyId: tag.companyId,
  name: tag.name,
  color: tag.color,
  createdAt: tag.createdAt,
  updatedAt: tag.updatedAt,
});

const mapUserSummary = (user: User) => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role,
  displayName: [user.firstName, user.lastName].filter(Boolean).join(" "),
});

export const mapConversationActivity = (
  activity: ConversationActivityWithActor
) => ({
  id: activity.id,
  conversationId: activity.conversationId,
  actorId: activity.actorId,
  actor: mapUserSummary(activity.actor),
  action: activity.action,
  metadata: activity.metadata,
  createdAt: activity.createdAt,
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
    status: conversation.status,
    teamId: conversation.teamId,
    team: conversation.team
      ? {
          id: conversation.team.id,
          name: conversation.team.name,
          description: conversation.team.description,
        }
      : null,

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
      attachments: mapAttachments(message.attachments ?? []),

      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    })) ?? [],
    attachments: mapAttachments(conversation.attachments ?? []),
    tags: conversation.tags?.map((link) => mapTag(link.tag)) ?? [],
    activities: conversation.activities?.map(mapConversationActivity),
  };
};

// Normalize multiple conversations response
export const mapConversations = (
  conversations: ConversationWithRelations[]
) => {
  return conversations.map(mapConversation);
};
