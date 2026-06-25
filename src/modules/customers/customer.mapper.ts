import {
  MessageSender,
  TicketActivityAction,
  TicketStatus,
  type Conversation,
  type Customer,
  type CustomerTag,
  type Message,
  type Tag,
  type Ticket,
  type TicketActivity,
  type TicketNote,
  type User,
} from "@prisma/client";

type SafeUser = Pick<User, "id" | "email" | "firstName" | "lastName" | "role">;

type ConversationWithMessages = Conversation & {
  messages?: Message[];
  tags?: TagLink[];
};

type TicketWithRelations = Ticket & {
  assignee?: SafeUser | null;
  activities?: TicketActivityWithActor[];
  notes?: TicketNoteWithAuthor[];
  tags?: TagLink[];
};

type TagLink = {
  tag: Tag;
};

type TicketActivityWithActor = TicketActivity & {
  actor: SafeUser | null;
};

type TicketNoteWithAuthor = TicketNote & {
  author: SafeUser;
};

type CustomerDetail = Customer & {
  conversations?: ConversationWithMessages[];
  tickets?: TicketWithRelations[];
  tags?: (CustomerTag & TagLink)[];
};

type TimelineItem = {
  id: string;
  type:
    | "CONVERSATION_CREATED"
    | "CUSTOMER_MESSAGE"
    | "AGENT_REPLY"
    | "TICKET_CREATED"
    | "TICKET_STATUS_CHANGED"
    | "TICKET_NOTE_ADDED"
    | "TICKET_RESOLVED";
  title: string;
  description?: string | null;
  timestamp: Date;
  channel?: string | null;
  conversationId?: string | null;
  ticketId?: string | null;
  actor?: ReturnType<typeof mapUserSummary>;
};

const finalStatuses = new Set<TicketStatus>([
  TicketStatus.RESOLVED,
  TicketStatus.CLOSED,
]);

const mapUserSummary = (user?: SafeUser | null) => {
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    displayName: [user.firstName, user.lastName].filter(Boolean).join(" "),
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

const mapTagLinks = (links: TagLink[] = []) =>
  links.map((link) => mapTag(link.tag));

const latestMessage = (messages: Message[] = []) =>
  [...messages].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )[0] ?? null;

const readMetadataString = (metadata: unknown, key: string) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
};

const mapConversationSummary = (conversation: ConversationWithMessages) => {
  const lastMessage = latestMessage(conversation.messages);

  return {
    id: conversation.id,
    customerId: conversation.customerId,
    channel: conversation.channel,
    status: conversation.status,
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          conversationId: lastMessage.conversationId,
          sender: lastMessage.sender,
          content: lastMessage.content,
          status: lastMessage.status,
          provider: lastMessage.provider,
          externalMessageId: lastMessage.externalMessageId,
          createdAt: lastMessage.createdAt,
          updatedAt: lastMessage.updatedAt,
        }
      : null,
    lastMessagePreview: lastMessage?.content ?? null,
    lastMessageAt: lastMessage?.createdAt ?? null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    tags: mapTagLinks(conversation.tags),
  };
};

const mapTicketSummary = (ticket: TicketWithRelations) => ({
  id: ticket.id,
  subject: ticket.subject,
  description: ticket.description,
  status: ticket.status,
  priority: ticket.priority,
  assigneeId: ticket.assigneeId,
  assignee: mapUserSummary(ticket.assignee),
  conversationId: ticket.conversationId,
  customerId: ticket.customerId,
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
  tags: mapTagLinks(ticket.tags),
});

const buildTimeline = (customer: CustomerDetail) => {
  const items: TimelineItem[] = [];

  for (const conversation of customer.conversations ?? []) {
    items.push({
      id: `conversation-${conversation.id}`,
      type: "CONVERSATION_CREATED",
      title: "Conversation created",
      description: `${conversation.channel} conversation started`,
      timestamp: conversation.createdAt,
      channel: conversation.channel,
      conversationId: conversation.id,
    });

    for (const message of conversation.messages ?? []) {
      items.push({
        id: `message-${message.id}`,
        type:
          message.sender === MessageSender.AGENT
            ? "AGENT_REPLY"
            : "CUSTOMER_MESSAGE",
        title:
          message.sender === MessageSender.AGENT
            ? "Agent reply sent"
            : "Customer message received",
        description: message.content,
        timestamp: message.createdAt,
        channel: conversation.channel,
        conversationId: conversation.id,
      });
    }
  }

  for (const ticket of customer.tickets ?? []) {
    items.push({
      id: `ticket-${ticket.id}`,
      type: "TICKET_CREATED",
      title: "Ticket created",
      description: ticket.subject,
      timestamp: ticket.createdAt,
      ticketId: ticket.id,
      conversationId: ticket.conversationId,
    });

    for (const activity of ticket.activities ?? []) {
      if (activity.action === TicketActivityAction.STATUS_CHANGED) {
        const to = readMetadataString(activity.metadata, "to");
        items.push({
          id: `activity-${activity.id}`,
          type:
            to === TicketStatus.RESOLVED
              ? "TICKET_RESOLVED"
              : "TICKET_STATUS_CHANGED",
          title:
            to === TicketStatus.RESOLVED
              ? "Ticket resolved"
              : "Ticket status changed",
          description: [
            readMetadataString(activity.metadata, "from"),
            to,
          ]
            .filter(Boolean)
            .join(" → "),
          timestamp: activity.createdAt,
          ticketId: activity.ticketId,
          actor: mapUserSummary(activity.actor),
        });
      }

      // Actual note records are added below so the customer timeline can show
      // useful note content without duplicating NOTE_ADDED activity rows.
    }

    for (const note of ticket.notes ?? []) {
      items.push({
        id: `note-${note.id}`,
        type: "TICKET_NOTE_ADDED",
        title: "Internal note",
        description: note.content,
        timestamp: note.createdAt,
        ticketId: note.ticketId,
        actor: mapUserSummary(note.author),
      });
    }
  }

  return items.sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
  );
};

const mapCustomerMetrics = (customer: CustomerDetail) => {
  const conversations = customer.conversations ?? [];
  const tickets = customer.tickets ?? [];
  const timeline = buildTimeline(customer);

  return {
    totalConversations: conversations.length,
    totalTickets: tickets.length,
    openTickets: tickets.filter((ticket) => !finalStatuses.has(ticket.status))
      .length,
    closedTickets: tickets.filter((ticket) => finalStatuses.has(ticket.status))
      .length,
    lastInteractionAt: timeline[0]?.timestamp ?? customer.updatedAt,
  };
};

// Normalize single customer response
export const mapCustomer = (customer: Customer) => {
  return {
    id: customer.id,

    companyId: customer.companyId,

    firstName: customer.firstName,
    lastName: customer.lastName,

    email: customer.email,
    phone: customer.phone,

    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    tags: mapTagLinks((customer as CustomerDetail).tags),
  };
};

export const mapCustomerDetail = (customer: CustomerDetail) => {
  const conversations = (customer.conversations ?? []).map(
    mapConversationSummary
  );
  const tickets = (customer.tickets ?? []).map(mapTicketSummary);
  const timeline = buildTimeline(customer);
  const metrics = mapCustomerMetrics(customer);
  const channelsUsed = Array.from(
    new Set(conversations.map((conversation) => conversation.channel))
  );

  return {
    ...mapCustomer(customer),
    channelsUsed,
    lastActivityAt: metrics.lastInteractionAt ?? customer.updatedAt,
    metrics,
    conversations,
    tickets,
    timeline,
  };
};

// Normalize multiple customers response
export const mapCustomers = (
  customer: Customer[]
) => {
  return customer.map(mapCustomer);
};
