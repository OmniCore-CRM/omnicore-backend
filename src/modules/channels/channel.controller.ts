import type { Request, Response } from "express";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { ChannelService } from "./channel.service.js";
import { normalizeWhatsAppMessage } from "./channel.normalizers.js";

export class ChannelController {
  // ===== Webhook verification =====
  static verifyWebhook = asyncHandler(
    async (req: Request, res: Response) => {
      
      // Extract Meta verification query params
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      // Validate verification request
      if (
        mode === "subscribe" &&
        token === process.env.WHATSAPP_VERIFY_TOKEN
      ) {
        console.log("Webhook verified successfully");
        
        return res.status(HTTP_STATUS.OK).send(challenge);
      }

      // Verification failed
      return res.sendStatus(403);
    }
  );

  // ===== Receive external webhook events =====
  static receiveWebhook = asyncHandler(
    
    async (req: Request, res: Response) => {
      console.log("Webhook POST hit");

      // Extract WhatsApp webhook payload safely
      const entry = req.body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const incomingMessage = value?.messages?.[0];

      // Ignore webhook if no inbound message exists
      if (!incomingMessage) {
        return sendResponse({
          res,
          statusCode: HTTP_STATUS.OK,
          message: "No inbound message found",
        });
      }

      // Normalize real WhatsApp webhook payload
      const normalizedMessage = normalizeWhatsAppMessage({
        messageId: incomingMessage.id,
        from: incomingMessage.from,
        customerName:
          value?.contacts?.[0]?.profile?.name ||
          "WhatsApp Customer",

        content: incomingMessage.text?.body || "",
        timestamp: incomingMessage.timestamp,
      });

      // Process normalized CRM message
      await ChannelService.processIncomingMessage(normalizedMessage);

      // TODO
      // Normalize provider payload
      // Process inbound messages
      // Process delivery events
      // Create conversations/messages
      // Emit realtime events

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Webhook event received successfully",
      });
    }
  );
}