import {
  ChannelProvider,
  type ChannelDeliveryEvent,
  type IncomingChannelMessage,
} from "./channel.types.js";

// ===== Normalize WhatsApp webhook payload =====
export const normalizeWhatsAppMessage =
  (
    payload: any
  ): IncomingChannelMessage => {
    return {
      provider: ChannelProvider.WHATSAPP,
      externalMessageId: payload.messageId,
      providerAccountId: payload.providerAccountId,
      externalUserId: payload.from,
      customerPhone: payload.from,
      customerName: payload.customerName,
      content: payload.content,
      timestamp: payload.timestamp,
    };
  };

export const normalizeWhatsAppStatus =
  (
    payload: any
  ): ChannelDeliveryEvent | null => {
    const status = String(payload.status || "").toLowerCase();
    const statusMap: Record<string, ChannelDeliveryEvent["status"]> = {
      sent: "SENT",
      delivered: "DELIVERED",
      read: "READ",
      failed: "FAILED",
    };

    const mappedStatus = statusMap[status];

    if (!payload.id || !mappedStatus) {
      return null;
    }

    return {
      provider: ChannelProvider.WHATSAPP,
      externalMessageId: payload.id,
      providerAccountId: payload.providerAccountId,
      status: mappedStatus,
      timestamp: payload.timestamp || new Date().toISOString(),
    };
  };
