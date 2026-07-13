import type { Request, Response } from "express";
import crypto from "node:crypto";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { ChannelService } from "./channel.service.js";
import { normalizeWhatsAppMessage, normalizeWhatsAppStatus } from "./channel.normalizers.js";
import { env } from "@/config/env.js";
import { AppError } from "@/core/errors/app-error.js";
import { WebhookReplayService } from "./webhook-replay.service.js";
import { WebhookProvider } from "@prisma/client";

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

const verifyMetaSignature = (req: RawBodyRequest) => {
  if (
    env.NODE_ENV === "development" &&
    env.ALLOW_UNSIGNED_WEBHOOKS_IN_DEVELOPMENT
  ) {
    return;
  }

  if (!env.WHATSAPP_APP_SECRET) {
    throw new AppError(
      "Webhook signature verification is not configured",
      HTTP_STATUS.UNAUTHORIZED
    );
  }

  const signatureHeader = req.get("x-hub-signature-256");

  if (!signatureHeader?.startsWith("sha256=") || !req.rawBody) {
    throw new AppError(
      "Invalid webhook signature",
      HTTP_STATUS.UNAUTHORIZED
    );
  }

  const expectedSignature =
    `sha256=${crypto
      .createHmac("sha256", env.WHATSAPP_APP_SECRET)
      .update(req.rawBody)
      .digest("hex")}`;

  const received = Buffer.from(signatureHeader);
  const expected = Buffer.from(expectedSignature);

  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(received, expected)
  ) {
    throw new AppError(
      "Invalid webhook signature",
      HTTP_STATUS.UNAUTHORIZED
    );
  }
};

const webhookSecurityContext = (req: RawBodyRequest) => {
  const signatureHeader = req.get("x-hub-signature-256");
  const rawPayload = req.rawBody?.toString("utf8") ?? "";
  const payloadFingerprint = WebhookReplayService.payloadFingerprint(rawPayload);

  return {
    requestId: (req as RawBodyRequest & { requestId?: string }).requestId,
    rawPayload,
    signatureFingerprint:
      WebhookReplayService.signatureFingerprint(signatureHeader),
    payloadFingerprint,
    signaturePresent: Boolean(signatureHeader),
  };
};

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
        env.WHATSAPP_VERIFY_TOKEN &&
        token === env.WHATSAPP_VERIFY_TOKEN
      ) {
        return res.status(HTTP_STATUS.OK).send(challenge);
      }

      // Verification failed
      return res.sendStatus(403);
    }
  );

  // ===== Receive external webhook events =====
  static receiveWebhook = asyncHandler(
    
    async (req: RawBodyRequest, res: Response) => {
      const security = webhookSecurityContext(req);

      try {
        verifyMetaSignature(req);
      } catch (error) {
        await WebhookReplayService.recordSecurityEvent({
          provider: WebhookProvider.WHATSAPP,
          eventType: "SECURITY_SIGNATURE_FAILED",
          requestId: security.requestId,
          signatureFingerprint: security.signatureFingerprint,
          payloadFingerprintSource: security.rawPayload,
          reason:
            error instanceof AppError ? error.message : "signature_verification_failed",
          metadata: {
            signaturePresent: security.signaturePresent,
          },
        });
        throw error;
      }

      // Extract WhatsApp webhook payload safely
      const entry = req.body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const providerAccountId = value?.metadata?.phone_number_id;
      const incomingMessage = value?.messages?.[0];
      const statusReceipt = value?.statuses?.[0];

      if (!statusReceipt && !incomingMessage) {
        await WebhookReplayService.recordSecurityEvent({
          provider: WebhookProvider.WHATSAPP,
          eventType: "SECURITY_TRUST_BOUNDARY_VIOLATION",
          requestId: security.requestId,
          signatureFingerprint: security.signatureFingerprint,
          payloadFingerprintSource: security.rawPayload,
          reason: "unsupported_payload_shape",
        });
      }

      if (statusReceipt) {
        const normalizedStatus = normalizeWhatsAppStatus({
          ...statusReceipt,
          providerAccountId,
        });

        if (normalizedStatus) {
          await ChannelService.processDeliveryEvent(normalizedStatus, {
            requestId: security.requestId,
            signatureFingerprint: security.signatureFingerprint,
            rawPayload: security.rawPayload,
          });
        } else {
          await WebhookReplayService.recordSecurityEvent({
            provider: WebhookProvider.WHATSAPP,
            eventType: "SECURITY_TRUST_BOUNDARY_VIOLATION",
            requestId: security.requestId,
            signatureFingerprint: security.signatureFingerprint,
            payloadFingerprintSource: security.rawPayload,
            reason: "invalid_status_payload",
            metadata: {
              providerAccountId,
            },
          });
        }

        return sendResponse({
          res,
          statusCode: HTTP_STATUS.OK,
          message: "Webhook status event received successfully",
        });
      }

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
        providerAccountId,
        from: incomingMessage.from,
        customerName:
          value?.contacts?.[0]?.profile?.name ||
          "WhatsApp Customer",

        content: incomingMessage.text?.body || "",
        timestamp: incomingMessage.timestamp,
      });

      // Process normalized CRM message
      await ChannelService.processIncomingMessage(normalizedMessage, {
        requestId: security.requestId,
        signatureFingerprint: security.signatureFingerprint,
        rawPayload: security.rawPayload,
      });

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
