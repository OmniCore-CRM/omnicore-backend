import {
  ChannelProvider,
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
      externalUserId: payload.from,
      customerPhone: payload.from,
      customerName: payload.customerName,
      content: payload.content,
      timestamp: payload.timestamp,
    };
  };