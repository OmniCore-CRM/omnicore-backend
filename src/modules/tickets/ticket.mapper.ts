import type {
  Conversation,
  Customer,
  Message,
  MessageSender,
  Tag,
  Ticket,
  TicketActivity,
  TicketTag,
  TicketNote,
  Team,
  User,
  Attachment,
} from "@prisma/client";
import { mapAttachments } from "@/modules/attachments/attachment.mapper.js";

type ConversationWithMessages = Conversation & {
  messages?: Message[];
};

type TicketWithRelations = Ticket & {
  assignee?: User | null;
  createdBy: User;
  customer?: Customer | null;
  conversation?: ConversationWithMessages | null;
  notes?: TicketNoteWithAuthor[];
  activities?: TicketActivityWithActor[];
  tags?: (TicketTag & { tag: Tag })[];
  team?: Team | null;
  attachments?: (Attachment & { uploadedBy?: User | null })[];
};

type TicketNoteWithAuthor = TicketNote & {
  author: User;
};

type TicketActivityWithActor = TicketActivity & {
  actor: User;
};

const mapUserSummary = (user?: User | null) => {
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    displayName: [user.firstName, user.lastName]
      .filter(Boolean)
      .join(" "),
  };
};

const mapCustomerSummary = (customer?: Customer | null) => {
  if (!customer) return null;

  return {
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
  };
};

const mapTag = (tag: Tag) => ({
  id: tag.id,
  companyId: tag.companyId,
  name: tag.name,
  color: tag.color,
  createdAt: tag.createdAt,
  updatedAt: tag.updatedAt,
});

const mapMessageSummary = (message?: Message | null) => {
  if (!message) return null;

  return {
    id: message.id,
    conversationId: message.conversationId,
    content: message.content,
    sender: message.sender,
    status: message.status,
    provider: message.provider,
    externalMessageId: message.externalMessageId,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
};

const getLatestMessageBySender = (
  messages: Message[],
  sender: MessageSender
) => messages.find((message) => message.sender === sender) ?? null;

const minutesBetween = (from: Date, to: Date) =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));

const readMetadataString = (metadata: unknown, key: string) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
};

const mapTicketMetrics = (ticket: TicketWithRelations) => {
  const messages = [...(ticket.conversation?.messages ?? [])].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
  const activities = [...(ticket.activities ?? [])].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
  const firstAgentReply =
    messages.find(
      (message) =>
        message.sender === "AGENT" &&
        message.createdAt.getTime() >= ticket.createdAt.getTime()
    ) ?? null;
  const resolvedActivity =
    activities.find(
      (activity) =>
        activity.action === "STATUS_CHANGED" &&
        readMetadataString(activity.metadata, "to") === "RESOLVED"
    ) ?? null;
  const resolvedAt =
    resolvedActivity?.createdAt ??
    (ticket.status === "RESOLVED" || ticket.status === "CLOSED"
      ? ticket.updatedAt
      : null);
  const endAt = resolvedAt ?? new Date();

  return {
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    firstResponseAt: firstAgentReply?.createdAt ?? null,
    firstResponseTimeMinutes: firstAgentReply
      ? minutesBetween(ticket.createdAt, firstAgentReply.createdAt)
      : null,
    resolvedAt,
    timeOpenMinutes: minutesBetween(ticket.createdAt, endAt),
  };
};

const mapConversationSummary = (
  conversation?: ConversationWithMessages | null
) => {
  if (!conversation) return null;

  const recentMessages = [...(conversation.messages ?? [])].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  return {
    id: conversation.id,
    customerId: conversation.customerId,
    channel: conversation.channel,
    latestCustomerMessage: mapMessageSummary(
      getLatestMessageBySender(recentMessages, "CUSTOMER")
    ),
    latestAgentReply: mapMessageSummary(
      getLatestMessageBySender(recentMessages, "AGENT")
    ),
    recentMessages: recentMessages.map(mapMessageSummary).filter(Boolean),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
};

export const mapTicket = (ticket: TicketWithRelations) => ({
  id: ticket.id,
  companyId: ticket.companyId,
  subject: ticket.subject,
  description: ticket.description,
  status: ticket.status,
  priority: ticket.priority,
  firstResponseDueAt: ticket.firstResponseDueAt,
  resolutionDueAt: ticket.resolutionDueAt,
  firstRespondedAt: ticket.firstRespondedAt,
  resolvedAt: ticket.resolvedAt,
  slaStatus: ticket.slaStatus,
  assigneeId: ticket.assigneeId,
  assignee: mapUserSummary(ticket.assignee),
  teamId: ticket.teamId,
  team: ticket.team
    ? {
        id: ticket.team.id,
        name: ticket.team.name,
        description: ticket.team.description,
      }
    : null,
  createdById: ticket.createdById,
  createdBy: mapUserSummary(ticket.createdBy),
  customerId: ticket.customerId,
  customer: mapCustomerSummary(ticket.customer),
  conversationId: ticket.conversationId,
  conversation: mapConversationSummary(ticket.conversation),
  notes: ticket.notes?.map(mapTicketNote) ?? undefined,
  activities: ticket.activities?.map(mapTicketActivity) ?? undefined,
  tags: ticket.tags?.map((link) => mapTag(link.tag)) ?? [],
  attachments: mapAttachments(ticket.attachments ?? []),
  metrics: mapTicketMetrics(ticket),
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
});

export const mapTickets = (tickets: TicketWithRelations[]) =>
  tickets.map(mapTicket);

export const mapTicketNote = (note: TicketNoteWithAuthor) => ({
  id: note.id,
  ticketId: note.ticketId,
  authorId: note.authorId,
  author: mapUserSummary(note.author),
  content: note.content,
  createdAt: note.createdAt,
});

export const mapTicketNotes = (notes: TicketNoteWithAuthor[]) =>
  notes.map(mapTicketNote);

export const mapTicketActivity = (
  activity: TicketActivityWithActor
) => ({
  id: activity.id,
  ticketId: activity.ticketId,
  actorId: activity.actorId,
  actor: mapUserSummary(activity.actor),
  action: activity.action,
  metadata: activity.metadata,
  createdAt: activity.createdAt,
});

export const mapTicketActivities = (
  activities: TicketActivityWithActor[]
) => activities.map(mapTicketActivity);
