import bcrypt from "bcrypt";
import {
  ConversationChannel,
  MessageSender,
  MessageStatus,
  PrismaClient,
  TicketActivityAction,
  TicketPriority,
  TicketStatus,
  UserRole,
} from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "OmniCoreDemo123!";
const DEMO_COMPANY_NAME = "OmniCore Demo Company";
const DEMO_WIDGET_KEY = "wpk_demo_staging_local";

async function getOrCreateCompany() {
  const ownerEmail = "owner@omnicore-staging.local";
  const existingOwner = await prisma.user.findUnique({
    where: {
      email: ownerEmail,
    },
  });

  if (existingOwner) {
    return prisma.company.findUniqueOrThrow({
      where: {
        id: existingOwner.companyId,
      },
    });
  }

  return prisma.company.create({
    data: {
      name: DEMO_COMPANY_NAME,
    },
  });
}

async function upsertUser(
  companyId: string,
  data: {
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
  }
) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  return prisma.user.upsert({
    where: {
      email: data.email,
    },
    update: {
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
      companyId,
    },
    create: {
      ...data,
      companyId,
      passwordHash,
    },
  });
}

async function getOrCreateCustomer(
  companyId: string,
  data: {
    firstName: string;
    lastName?: string;
    email: string;
    phone?: string;
  }
) {
  const existing = await prisma.customer.findFirst({
    where: {
      companyId,
      email: data.email,
    },
  });

  if (existing) return existing;

  return prisma.customer.create({
    data: {
      ...data,
      companyId,
    },
  });
}

async function getOrCreateConversation(
  companyId: string,
  customerId: string,
  channel: ConversationChannel
) {
  const existing = await prisma.conversation.findFirst({
    where: {
      companyId,
      customerId,
      channel,
    },
  });

  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      companyId,
      customerId,
      channel,
    },
  });
}

async function ensureMessage(
  companyId: string,
  conversationId: string,
  data: {
    sender: MessageSender;
    content: string;
    status?: MessageStatus;
    provider?: ConversationChannel;
  }
) {
  const existing = await prisma.message.findFirst({
    where: {
      companyId,
      conversationId,
      content: data.content,
      sender: data.sender,
    },
  });

  if (existing) return existing;

  return prisma.message.create({
    data: {
      companyId,
      conversationId,
      sender: data.sender,
      content: data.content,
      status: data.status ?? MessageStatus.SENT,
      provider: data.provider,
    },
  });
}

async function getOrCreateTicket(
  companyId: string,
  createdById: string,
  data: {
    subject: string;
    description: string;
    status: TicketStatus;
    priority: TicketPriority;
    customerId: string;
    conversationId: string;
    assigneeId?: string;
  }
) {
  const existing = await prisma.ticket.findFirst({
    where: {
      companyId,
      subject: data.subject,
    },
  });

  if (existing) return existing;

  const ticket = await prisma.ticket.create({
    data: {
      companyId,
      createdById,
      ...data,
    },
  });

  await prisma.ticketActivity.create({
    data: {
      companyId,
      ticketId: ticket.id,
      actorId: createdById,
      action: TicketActivityAction.TICKET_CREATED,
      metadata: {
        seeded: true,
        status: ticket.status,
        priority: ticket.priority,
      },
    },
  });

  if (ticket.assigneeId) {
    await prisma.ticketActivity.create({
      data: {
        companyId,
        ticketId: ticket.id,
        actorId: createdById,
        action: TicketActivityAction.ASSIGNED,
        metadata: {
          seeded: true,
          assigneeId: ticket.assigneeId,
        },
      },
    });
  }

  return ticket;
}

async function ensureTicketNote(
  companyId: string,
  ticketId: string,
  authorId: string,
  content: string
) {
  const existing = await prisma.ticketNote.findFirst({
    where: {
      companyId,
      ticketId,
      content,
    },
  });

  if (existing) return existing;

  const note = await prisma.ticketNote.create({
    data: {
      companyId,
      ticketId,
      authorId,
      content,
    },
  });

  await prisma.ticketActivity.create({
    data: {
      companyId,
      ticketId,
      actorId: authorId,
      action: TicketActivityAction.NOTE_ADDED,
      metadata: {
        seeded: true,
        noteId: note.id,
      },
    },
  });

  return note;
}

async function main() {
  const company = await getOrCreateCompany();
  const [owner, admin, agent, viewer] = await Promise.all([
    upsertUser(company.id, {
      email: "owner@omnicore-staging.local",
      firstName: "Olivia",
      lastName: "Owner",
      role: UserRole.OWNER,
    }),
    upsertUser(company.id, {
      email: "admin@omnicore-staging.local",
      firstName: "Amara",
      lastName: "Admin",
      role: UserRole.ADMIN,
    }),
    upsertUser(company.id, {
      email: "agent@omnicore-staging.local",
      firstName: "Ayo",
      lastName: "Agent",
      role: UserRole.AGENT,
    }),
    upsertUser(company.id, {
      email: "viewer@omnicore-staging.local",
      firstName: "Victor",
      lastName: "Viewer",
      role: UserRole.VIEWER,
    }),
  ]);

  await prisma.widgetInstallation.upsert({
    where: {
      publicKey: DEMO_WIDGET_KEY,
    },
    update: {
      companyId: company.id,
      enabled: true,
      allowedDomains: ["localhost:3000", "localhost:3001"],
    },
    create: {
      companyId: company.id,
      publicKey: DEMO_WIDGET_KEY,
      enabled: true,
      allowedDomains: ["localhost:3000", "localhost:3001"],
    },
  });

  const sarah = await getOrCreateCustomer(company.id, {
    firstName: "Sarah",
    lastName: "Johnson",
    email: "sarah.demo@example.com",
    phone: "+15550001001",
  });
  const malik = await getOrCreateCustomer(company.id, {
    firstName: "Malik",
    lastName: "Okafor",
    email: "malik.demo@example.com",
    phone: "+15550001002",
  });
  const nina = await getOrCreateCustomer(company.id, {
    firstName: "Nina",
    lastName: "Patel",
    email: "nina.demo@example.com",
    phone: "+15550001003",
  });

  const whatsappConversation = await getOrCreateConversation(
    company.id,
    sarah.id,
    ConversationChannel.WHATSAPP
  );
  const widgetConversation = await getOrCreateConversation(
    company.id,
    malik.id,
    ConversationChannel.WEBSITE
  );
  const pendingConversation = await getOrCreateConversation(
    company.id,
    nina.id,
    ConversationChannel.WHATSAPP
  );

  await ensureMessage(company.id, whatsappConversation.id, {
    sender: MessageSender.CUSTOMER,
    content: "Hi, I need help checking my order status.",
    status: MessageStatus.READ,
    provider: ConversationChannel.WHATSAPP,
  });
  await ensureMessage(company.id, whatsappConversation.id, {
    sender: MessageSender.AGENT,
    content: "Thanks Sarah. I am checking this for you now.",
    status: MessageStatus.DELIVERED,
    provider: ConversationChannel.WHATSAPP,
  });
  await ensureMessage(company.id, widgetConversation.id, {
    sender: MessageSender.CUSTOMER,
    content: "Can someone help me choose the right plan?",
    status: MessageStatus.SENT,
    provider: ConversationChannel.WEBSITE,
  });
  await ensureMessage(company.id, pendingConversation.id, {
    sender: MessageSender.AGENT,
    content: "This is an example pending outbound WhatsApp message.",
    status: MessageStatus.PENDING,
    provider: ConversationChannel.WHATSAPP,
  });
  await ensureMessage(company.id, pendingConversation.id, {
    sender: MessageSender.AGENT,
    content: "This is an example failed outbound WhatsApp message.",
    status: MessageStatus.FAILED,
    provider: ConversationChannel.WHATSAPP,
  });

  const openTicket = await getOrCreateTicket(company.id, owner.id, {
    subject: "Order status follow-up",
    description: "Sarah asked for an update on her order status.",
    status: TicketStatus.OPEN,
    priority: TicketPriority.MEDIUM,
    customerId: sarah.id,
    conversationId: whatsappConversation.id,
    assigneeId: agent.id,
  });
  const pendingTicket = await getOrCreateTicket(company.id, admin.id, {
    subject: "Website plan question",
    description: "Malik needs help choosing a plan from website chat.",
    status: TicketStatus.PENDING,
    priority: TicketPriority.LOW,
    customerId: malik.id,
    conversationId: widgetConversation.id,
    assigneeId: agent.id,
  });
  const escalatedTicket = await getOrCreateTicket(company.id, admin.id, {
    subject: "Payment confirmation issue",
    description: "Nina reports payment confirmation has not arrived.",
    status: TicketStatus.ESCALATED,
    priority: TicketPriority.URGENT,
    customerId: nina.id,
    conversationId: pendingConversation.id,
    assigneeId: admin.id,
  });

  await ensureTicketNote(
    company.id,
    openTicket.id,
    agent.id,
    "Demo note: confirm order status before replying to Sarah."
  );
  await ensureTicketNote(
    company.id,
    pendingTicket.id,
    admin.id,
    "Demo note: use this ticket to test internal note visibility."
  );
  await ensureTicketNote(
    company.id,
    escalatedTicket.id,
    owner.id,
    "Demo note: urgent staging ticket for escalation-style review."
  );

  console.log("Seeded OmniCore staging demo data.");
  console.log(`Company: ${company.name}`);
  console.log(`Password for demo users: ${DEMO_PASSWORD}`);
  console.log(`Owner: ${owner.email}`);
  console.log(`Admin: ${admin.email}`);
  console.log(`Agent: ${agent.email}`);
  console.log(`Viewer: ${viewer.email}`);
  console.log(`Widget public key: ${DEMO_WIDGET_KEY}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
