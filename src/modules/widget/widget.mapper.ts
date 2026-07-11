import type {
  Conversation,
  Customer,
  Message,
  WidgetInstallation,
  WidgetFaqEntry,
  WidgetArticle,
  WidgetArticleCategory,
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

type WidgetArticleCreator = Pick<
  User,
  "id" | "email" | "firstName" | "lastName" | "role"
>;

type WidgetArticleWithRelations = WidgetArticle & {
  category?: WidgetArticleCategory | null;
  createdBy?: WidgetArticleCreator | null;
};

export const mapWidgetArticleCategory = (category: WidgetArticleCategory) => ({
  id: category.id,
  companyId: category.companyId,
  widgetInstallationId: category.widgetInstallationId,
  name: category.name,
  slug: category.slug,
  sortOrder: category.sortOrder,
  createdAt: category.createdAt,
  updatedAt: category.updatedAt,
});

export const mapWidgetArticleCategories = (
  categories: WidgetArticleCategory[]
) => categories.map(mapWidgetArticleCategory);

export const mapWidgetArticle = (article: WidgetArticleWithRelations) => ({
  id: article.id,
  companyId: article.companyId,
  widgetInstallationId: article.widgetInstallationId,
  title: article.title,
  slug: article.slug,
  summary: article.summary,
  content: article.content,
  categoryId: article.categoryId,
  status: article.status,
  sortOrder: article.sortOrder,
  publishedAt: article.publishedAt,
  createdById: article.createdById,
  category: article.category ? mapWidgetArticleCategory(article.category) : null,
  createdBy: article.createdBy
    ? {
        id: article.createdBy.id,
        email: article.createdBy.email,
        firstName: article.createdBy.firstName,
        lastName: article.createdBy.lastName,
        role: article.createdBy.role,
      }
    : null,
  createdAt: article.createdAt,
  updatedAt: article.updatedAt,
});

export const mapWidgetArticles = (articles: WidgetArticleWithRelations[]) =>
  articles.map(mapWidgetArticle);

export const mapPublicWidgetArticleCategory = (category: WidgetArticleCategory) => ({
  id: category.id,
  name: category.name,
  slug: category.slug,
  sortOrder: category.sortOrder,
});

export const mapPublicWidgetArticleCategories = (
  categories: WidgetArticleCategory[]
) => categories.map(mapPublicWidgetArticleCategory);

type PublicWidgetArticleWithRelations = WidgetArticle & {
  category?: WidgetArticleCategory | null;
};

export const mapPublicWidgetArticle = (
  article: PublicWidgetArticleWithRelations
) => ({
  id: article.id,
  title: article.title,
  slug: article.slug,
  summary: article.summary,
  content: article.content,
  publishedAt: article.publishedAt,
  category: article.category
    ? mapPublicWidgetArticleCategory(article.category)
    : null,
});

export const mapPublicWidgetArticles = (
  articles: PublicWidgetArticleWithRelations[]
) => articles.map(mapPublicWidgetArticle);

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
