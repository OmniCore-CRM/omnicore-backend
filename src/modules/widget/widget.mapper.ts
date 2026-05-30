import type {
  Conversation,
  Customer,
  Message,
  WidgetInstallation,
} from "@prisma/client";

export const mapWidgetInstallation = (
  installation: WidgetInstallation
) => ({
  id: installation.id,
  publicKey: installation.publicKey,
  enabled: installation.enabled,
  allowedDomains: installation.allowedDomains,
  createdAt: installation.createdAt,
  updatedAt: installation.updatedAt,
});

export const mapWidgetInstallations = (
  installations: WidgetInstallation[]
) => installations.map(mapWidgetInstallation);

export const mapWidgetBootstrap = (
  installation: WidgetInstallation
) => ({
  publicKey: installation.publicKey,
  enabled: installation.enabled,
});

export const mapPublicWidgetCustomer = (customer: Customer) => ({
  id: customer.id,
  firstName: customer.firstName,
  lastName: customer.lastName,
  email: customer.email,
  phone: customer.phone,
  createdAt: customer.createdAt,
  updatedAt: customer.updatedAt,
});

export const mapPublicWidgetMessage = (message: Message) => ({
  id: message.id,
  conversationId: message.conversationId,
  sender: message.sender,
  content: message.content,
  status: message.status,
  provider: message.provider,
  externalMessageId: message.externalMessageId,
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
});

export const mapPublicWidgetMessages = (messages: Message[]) =>
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
