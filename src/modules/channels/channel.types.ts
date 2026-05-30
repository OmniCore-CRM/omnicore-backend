// ===== Supported communication providers =====
export enum ChannelProvider {
  WHATSAPP = "WHATSAPP",
  WEBSITE = "WEBSITE",
  INSTAGRAM = "INSTAGRAM",
  MESSENGER = "MESSENGER",
}

// ===== Incoming webhook event types =====
export enum ChannelWebhookEventType {
  MESSAGE_RECEIVED = "MESSAGE_RECEIVED",
  MESSAGE_DELIVERED = "MESSAGE_DELIVERED",
  MESSAGE_READ = "MESSAGE_READ",
}

// ===== Normalized inbound message payload =====
export type IncomingChannelMessage = {
  provider: ChannelProvider;
  externalMessageId: string;
  externalUserId: string;
  externalConversationId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  content: string;
  timestamp: string;
};

// ===== Normalized delivery event payload =====
export type ChannelDeliveryEvent = {
  provider: ChannelProvider;
  externalMessageId: string;

  status:
    | "PENDING"
    | "SENT"
    | "DELIVERED"
    | "READ"
    | "FAILED";

  timestamp: string;
};
