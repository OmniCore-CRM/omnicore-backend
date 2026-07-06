import type {
  Conversation,
  ConversationActivity,
  ConversationTag,
  Customer,
  Message,
  Tag,
  Team,
  Ticket,
  User,
  Attachment,
} from "@prisma/client";
import { mapAttachments } from "@/modules/attachments/attachment.mapper.js";

type SafeUser = Pick<
  User,
  "id" | "email" | "firstName" | "lastName" | "role"
>;
type SafeCustomer = Pick<
  Customer,
  "id" | "firstName" | "lastName" | "email" | "phone"
>;
type SafeTeam = Pick<Team, "id" | "name" | "description">;
type SafeTag = Pick<
  Tag,
  "id" | "companyId" | "name" | "color" | "createdAt" | "updatedAt"
>;
type SafeMessage = Pick<
  Message,
  | "id"
  | "companyId"
  | "conversationId"
  | "sender"
  | "content"
  | "status"
  | "provider"
  | "createdAt"
  | "updatedAt"
> &
  Partial<Pick<Message, "externalMessageId" | "metadata">> & {
    attachments?: (Attachment & { uploadedBy?: SafeUser | null })[];
  };

// Conversation payload with related entities
type ConversationWithRelations = Conversation & {
  customer: SafeCustomer;
  assignee?: SafeUser | null;
  messages?: SafeMessage[];
  attachments?: (Attachment & { uploadedBy?: SafeUser | null })[];
  tags?: (Pick<ConversationTag, "createdAt"> & { tag: SafeTag })[];
  activities?: ConversationActivityWithActor[];
  team?: SafeTeam | null;
  tickets?: ConversationTicketWithRelations[];
};

type ConversationActivityWithActor = ConversationActivity & {
  actor: SafeUser | null;
};

type ConversationTicketWithRelations = Pick<
  Ticket,
  | "id"
  | "subject"
  | "status"
  | "priority"
  | "assigneeId"
  | "createdAt"
  | "updatedAt"
> & {
  assignee?: SafeUser | null;
};

const mapTag = (tag: SafeTag) => ({
  id: tag.id,
  companyId: tag.companyId,
  name: tag.name,
  color: tag.color,
  createdAt: tag.createdAt,
  updatedAt: tag.updatedAt,
});

const mapUserSummary = (user?: SafeUser | null) =>
  user
    ? {
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role,
  displayName: [user.firstName, user.lastName].filter(Boolean).join(" "),
      }
    : null;

const mapTicketSummary = (ticket: ConversationTicketWithRelations) => ({
  id: ticket.id,
  subject: ticket.subject,
  status: ticket.status,
  priority: ticket.priority,
  assigneeId: ticket.assigneeId,
  assignee: mapUserSummary(ticket.assignee),
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
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
  const latestMessage = [...(conversation.messages ?? [])].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )[0];

  return {
    id: conversation.id,
    companyId: conversation.companyId,
    customerId: conversation.customerId,

    channel: conversation.channel,
    status: conversation.status,
    subject: conversation.subject,
    assigneeId: conversation.assigneeId,
    assignee: mapUserSummary(conversation.assignee),
    teamId: conversation.teamId,
    team: conversation.team
      ? {
          id: conversation.team.id,
          name: conversation.team.name,
          description: conversation.team.description,
        }
      : null,
    tickets: conversation.tickets?.map(mapTicketSummary) ?? [],
    primaryTicket: conversation.tickets?.[0]
      ? mapTicketSummary(conversation.tickets[0])
      : null,

    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessage: latestMessage
      ? {
          id: latestMessage.id,
          companyId: latestMessage.companyId,
          conversationId: latestMessage.conversationId,
          sender: latestMessage.sender,
          content: latestMessage.content,
          status: latestMessage.status,
          provider: latestMessage.provider,
          externalMessageId: latestMessage.externalMessageId,
          metadata: latestMessage.metadata,
          createdAt: latestMessage.createdAt,
          updatedAt: latestMessage.updatedAt,
        }
      : null,
    latestMessage: latestMessage
      ? {
          id: latestMessage.id,
          companyId: latestMessage.companyId,
          conversationId: latestMessage.conversationId,
          sender: latestMessage.sender,
          content: latestMessage.content,
          status: latestMessage.status,
          provider: latestMessage.provider,
          externalMessageId: latestMessage.externalMessageId,
          metadata: latestMessage.metadata,
          createdAt: latestMessage.createdAt,
          updatedAt: latestMessage.updatedAt,
        }
      : null,
    lastMessagePreview: latestMessage?.content ?? null,
    lastMessageAt: latestMessage?.createdAt ?? null,

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
      metadata: message.metadata,
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
