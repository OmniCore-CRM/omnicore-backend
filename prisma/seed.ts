import bcrypt from "bcrypt";
import {
  ConversationChannel,
  ConversationStatus,
  EmailAccountStatus,
  EmailProvider,
  MessageSender,
  MessageStatus,
  ProviderAccountStatus,
  PrismaClient,
  TicketActivityAction,
  TicketPriority,
  TicketStatus,
  UserLifecycleStatus,
  UserRole,
} from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "OmniCoreDemo123!";
const DEMO_COMPANY_NAME = "OmniCore Demo Company";
const DEMO_COMPANY_SLUG = "omnicore-demo";
const DEMO_WIDGET_KEY = "wpk_demo_staging_local";

const assertShadowSafety = () => {
  const databaseUrl = process.env.DATABASE_URL;
  const shadowUrl = process.env.SHADOW_DATABASE_URL;

  if (!databaseUrl || !shadowUrl) {
    return;
  }

  const normalize = (url: string) => url.trim().replace(/\?.*$/, "").replace(/\/$/, "");

  if (normalize(databaseUrl) === normalize(shadowUrl)) {
    throw new Error(
      "Unsafe configuration: DATABASE_URL and SHADOW_DATABASE_URL must never be identical"
    );
  }
};

async function getOrCreateCompany() {
  return prisma.company.upsert({
    create: {
      name: DEMO_COMPANY_NAME,
      companySlug: DEMO_COMPANY_SLUG,
      supportPortalEnabled: true,
    },
    where: {
      companySlug: DEMO_COMPANY_SLUG,
    },
    update: {
      name: DEMO_COMPANY_NAME,
      supportPortalEnabled: true,
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
      passwordHash,
      status: UserLifecycleStatus.ACTIVE,
      isActive: true,
    },
    create: {
      ...data,
      companyId,
      passwordHash,
      status: UserLifecycleStatus.ACTIVE,
      isActive: true,
    },
  });
}

async function upsertTeam(
  companyId: string,
  data: {
    name: string;
    description?: string;
  }
) {
  return prisma.team.upsert({
    where: {
      companyId_name: {
        companyId,
        name: data.name,
      },
    },
    update: {
      description: data.description,
    },
    create: {
      companyId,
      name: data.name,
      description: data.description,
    },
  });
}

async function ensureTeamMembership(
  companyId: string,
  teamId: string,
  userId: string
) {
  return prisma.teamMember.upsert({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
    update: {
      companyId,
    },
    create: {
      companyId,
      teamId,
      userId,
    },
  });
}

async function upsertEmailAccount(
  companyId: string,
  data: {
    provider: EmailProvider;
    fromEmail: string;
    fromName: string;
  }
) {
  return prisma.emailAccount.upsert({
    where: {
      provider_fromEmail: {
        provider: data.provider,
        fromEmail: data.fromEmail,
      },
    },
    update: {
      companyId,
      fromName: data.fromName,
      status: EmailAccountStatus.ACTIVE,
      metadata: { seeded: true },
    },
    create: {
      companyId,
      provider: data.provider,
      fromEmail: data.fromEmail,
      fromName: data.fromName,
      status: EmailAccountStatus.ACTIVE,
      metadata: { seeded: true },
    },
  });
}

async function upsertWhatsAppAccount(
  companyId: string,
  data: {
    phoneNumberId: string;
    displayPhoneNumber: string;
  }
) {
  return prisma.whatsAppAccount.upsert({
    where: {
      phoneNumberId: data.phoneNumberId,
    },
    update: {
      companyId,
      displayPhoneNumber: data.displayPhoneNumber,
      status: ProviderAccountStatus.ACTIVE,
      metadata: { seeded: true },
    },
    create: {
      companyId,
      phoneNumberId: data.phoneNumberId,
      displayPhoneNumber: data.displayPhoneNumber,
      status: ProviderAccountStatus.ACTIVE,
      metadata: { seeded: true },
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

  if (existing) {
    return prisma.customer.update({
      where: { id: existing.id },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
      },
    });
  }

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
  data: {
    channel: ConversationChannel;
    status?: ConversationStatus;
    subject?: string;
    assigneeId?: string;
    teamId?: string;
  }
) {
  const existing = await prisma.conversation.findFirst({
    where: {
      companyId,
      customerId,
      channel: data.channel,
    },
  });

  if (existing) {
    return prisma.conversation.update({
      where: { id: existing.id },
      data: {
        status: data.status,
        subject: data.subject,
        assigneeId: data.assigneeId,
        teamId: data.teamId,
      },
    });
  }

  return prisma.conversation.create({
    data: {
      companyId,
      customerId,
      channel: data.channel,
      status: data.status,
      subject: data.subject,
      assigneeId: data.assigneeId,
      teamId: data.teamId,
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

  if (existing) {
    return prisma.message.update({
      where: { id: existing.id },
      data: {
        status: data.status ?? MessageStatus.SENT,
        provider: data.provider,
      },
    });
  }

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
    teamId?: string;
  }
) {
  const existing = await prisma.ticket.findFirst({
    where: {
      companyId,
      subject: data.subject,
    },
  });

  if (existing) {
    return prisma.ticket.update({
      where: { id: existing.id },
      data: {
        description: data.description,
        status: data.status,
        priority: data.priority,
        customerId: data.customerId,
        conversationId: data.conversationId,
        assigneeId: data.assigneeId,
        teamId: data.teamId,
      },
    });
  }

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
  assertShadowSafety();

  const company = await getOrCreateCompany();
  const [owner, admin, teamLead, agent, viewer] = await Promise.all([
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
      email: "lead@omnicore-staging.local",
      firstName: "Tola",
      lastName: "Lead",
      role: UserRole.TEAM_LEAD,
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

  const [supportTeam, escalationsTeam] = await Promise.all([
    upsertTeam(company.id, {
      name: "Support",
      description: "Frontline inbound support queue",
    }),
    upsertTeam(company.id, {
      name: "Escalations",
      description: "Urgent and high-priority escalations",
    }),
  ]);

  await Promise.all([
    ensureTeamMembership(company.id, supportTeam.id, owner.id),
    ensureTeamMembership(company.id, supportTeam.id, admin.id),
    ensureTeamMembership(company.id, supportTeam.id, teamLead.id),
    ensureTeamMembership(company.id, supportTeam.id, agent.id),
    ensureTeamMembership(company.id, escalationsTeam.id, owner.id),
    ensureTeamMembership(company.id, escalationsTeam.id, admin.id),
    ensureTeamMembership(company.id, escalationsTeam.id, teamLead.id),
  ]);

  await Promise.all([
    upsertEmailAccount(company.id, {
      provider: EmailProvider.RESEND,
      fromEmail: "support@omnicore-staging.local",
      fromName: "OmniCore Support",
    }),
    upsertWhatsAppAccount(company.id, {
      phoneNumberId: "wa_demo_phone_001",
      displayPhoneNumber: "+1 555 123 4567",
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
      companyDisplayName: "OmniCore Demo",
      welcomeTitle: "Talk to OmniCore",
      welcomeSubtitle: "We are here to help with your account and orders.",
      chatGreeting: "Hi there, how can we help?",
      launcherLabel: "Support",
      footerNote: "Demo environment",
      messageShortcuts: ["Order status", "Billing help", "Product question"],
    },
    create: {
      companyId: company.id,
      publicKey: DEMO_WIDGET_KEY,
      enabled: true,
      allowedDomains: ["localhost:3000", "localhost:3001"],
      companyDisplayName: "OmniCore Demo",
      welcomeTitle: "Talk to OmniCore",
      welcomeSubtitle: "We are here to help with your account and orders.",
      chatGreeting: "Hi there, how can we help?",
      launcherLabel: "Support",
      footerNote: "Demo environment",
      messageShortcuts: ["Order status", "Billing help", "Product question"],
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
    {
      channel: ConversationChannel.WHATSAPP,
      status: ConversationStatus.OPEN,
      subject: "Order update",
      assigneeId: agent.id,
      teamId: supportTeam.id,
    }
  );
  const widgetConversation = await getOrCreateConversation(
    company.id,
    malik.id,
    {
      channel: ConversationChannel.WEBSITE,
      status: ConversationStatus.PENDING,
      subject: "Plan selection help",
      assigneeId: agent.id,
      teamId: supportTeam.id,
    }
  );
  const pendingConversation = await getOrCreateConversation(
    company.id,
    nina.id,
    {
      channel: ConversationChannel.WHATSAPP,
      status: ConversationStatus.OPEN,
      subject: "Payment confirmation issue",
      assigneeId: admin.id,
      teamId: escalationsTeam.id,
    }
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
    teamId: supportTeam.id,
  });
  const pendingTicket = await getOrCreateTicket(company.id, admin.id, {
    subject: "Website plan question",
    description: "Malik needs help choosing a plan from website chat.",
    status: TicketStatus.PENDING,
    priority: TicketPriority.LOW,
    customerId: malik.id,
    conversationId: widgetConversation.id,
    assigneeId: agent.id,
    teamId: supportTeam.id,
  });
  const escalatedTicket = await getOrCreateTicket(company.id, admin.id, {
    subject: "Payment confirmation issue",
    description: "Nina reports payment confirmation has not arrived.",
    status: TicketStatus.ESCALATED,
    priority: TicketPriority.URGENT,
    customerId: nina.id,
    conversationId: pendingConversation.id,
    assigneeId: admin.id,
    teamId: escalationsTeam.id,
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
  console.log(`Team lead: ${teamLead.email}`);
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
