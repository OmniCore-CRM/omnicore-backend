import type {
  Conversation,
  Customer,
  Message,
  WidgetInstallation,
  WidgetFaqEntry,
  Attachment,
  User,
} from "@prisma/client";
import { mapAttachments } from "@/modules/attachments/attachment.mapper.js";

export const mapWidgetInstallation = (
  installation: WidgetInstallation
) => ({
  id: installation.id,
  publicKey: installation.publicKey,
  enabled: installation.enabled,
  allowedDomains: installation.allowedDomains,
  companyDisplayName: installation.companyDisplayName,
  welcomeTitle: installation.welcomeTitle,
  welcomeSubtitle: installation.welcomeSubtitle,
  chatGreeting: installation.chatGreeting,
  launcherLabel: installation.launcherLabel,
  footerNote: installation.footerNote,
  messageShortcuts: installation.messageShortcuts,
  logoUrl: installation.logoUrl,
  heroImageUrl: installation.heroImageUrl,
  brandColor: installation.brandColor,
  createdAt: installation.createdAt,
  updatedAt: installation.updatedAt,
});

export const mapWidgetInstallations = (
  installations: WidgetInstallation[]
) => installations.map(mapWidgetInstallation);

export const mapWidgetBootstrap = (
  installation: WidgetInstallation,
  faqEntries: WidgetFaqEntry[] = []
) => ({
  publicKey: installation.publicKey,
  enabled: installation.enabled,
  companyDisplayName: installation.companyDisplayName,
  welcomeTitle: installation.welcomeTitle,
  welcomeSubtitle: installation.welcomeSubtitle,
  chatGreeting: installation.chatGreeting,
  launcherLabel: installation.launcherLabel,
  footerNote: installation.footerNote,
  messageShortcuts: installation.messageShortcuts,
  logoUrl: installation.logoUrl,
  heroImageUrl: installation.heroImageUrl,
  brandColor: installation.brandColor,
  faqEntries: faqEntries.map((e) => ({
    id: e.id,
    question: e.question,
    answer: e.answer,
    sortOrder: e.sortOrder,
  })),
});

export const mapWidgetFaqEntry = (entry: WidgetFaqEntry) => ({
  id: entry.id,
  widgetInstallationId: entry.widgetInstallationId,
  companyId: entry.companyId,
  question: entry.question,
  answer: entry.answer,
  sortOrder: entry.sortOrder,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
});

export const mapWidgetFaqEntries = (entries: WidgetFaqEntry[]) =>
  entries.map(mapWidgetFaqEntry);

export const mapPublicWidgetCustomer = (customer: Customer) => ({
  id: customer.id,
  firstName: customer.firstName,
  lastName: customer.lastName,
  email: customer.email,
  phone: customer.phone,
  createdAt: customer.createdAt,
  updatedAt: customer.updatedAt,
});

type AttachmentUploader = Pick<User, "id" | "firstName" | "lastName">;

export const mapPublicWidgetMessage = (
  message: Message & {
    attachments?: (Attachment & { uploadedBy?: AttachmentUploader | null })[];
  }
) => ({
  id: message.id,
  conversationId: message.conversationId,
  sender: message.sender,
  content: message.content,
  status: message.status,
  provider: message.provider,
  externalMessageId: message.externalMessageId,
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
  attachments: mapAttachments(message.attachments ?? []),
});

export const mapPublicWidgetMessages = (
  messages: (Message & {
    attachments?: (Attachment & { uploadedBy?: AttachmentUploader | null })[];
  })[]
) =>
  messages.map(mapPublicWidgetMessage);

export const mapPublicWidgetConversation = (
  conversation: Conversation & {
    customer: Customer;
    messages?: Message[];
  }
) => ({
  id: conversation.id,
  customerId: conversation.customerId,
  channel: conversation.channel,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
  customer: mapPublicWidgetCustomer(conversation.customer),
  messages: mapPublicWidgetMessages(conversation.messages ?? []),
});
