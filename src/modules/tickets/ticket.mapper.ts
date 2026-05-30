import type {
  Conversation,
  Customer,
  Ticket,
  User,
} from "@prisma/client";

type TicketWithRelations = Ticket & {
  assignee?: User | null;
  createdBy: User;
  customer?: Customer | null;
  conversation?: Conversation | null;
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

const mapConversationSummary = (
  conversation?: Conversation | null
) => {
  if (!conversation) return null;

  return {
    id: conversation.id,
    customerId: conversation.customerId,
    channel: conversation.channel,
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
  assigneeId: ticket.assigneeId,
  assignee: mapUserSummary(ticket.assignee),
  createdById: ticket.createdById,
  createdBy: mapUserSummary(ticket.createdBy),
  customerId: ticket.customerId,
  customer: mapCustomerSummary(ticket.customer),
  conversationId: ticket.conversationId,
  conversation: mapConversationSummary(ticket.conversation),
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
});

export const mapTickets = (tickets: TicketWithRelations[]) =>
  tickets.map(mapTicket);
