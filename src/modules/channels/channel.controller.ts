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
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { ChannelReconciliationService } from "./channel-reconciliation.service.js";
import type { ChannelDeliveryEvent } from "./channel.types.js";
import { ChannelObservabilityService } from "./channel-observability.service.js";

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
  static operationsOverview = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Channel operations overview retrieved successfully",
        data: await ChannelObservabilityService.operationsOverview(
          req.user!.companyId
        ),
      });
    }
  );

  static reconcileReliability = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const result = await ChannelReconciliationService.runCompany(req.user!.companyId);

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Channel reconciliation completed",
        data: result,
      });
    }
  );

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
      const startedAt = Date.now();
      const security = webhookSecurityContext(req);

      try {
        verifyMetaSignature(req);
      } catch (error) {
        ChannelObservabilityService.record({
          metric: "webhook.signature_failed",
          provider: "WHATSAPP",
          requestId: security.requestId,
          providerEventId: null,
          companyId: null,
          eventType: "WHATSAPP_WEBHOOK",
          outcome: "rejected",
          latencyMs: Date.now() - startedAt,
          safeErrorCode: error instanceof AppError ? error.code ?? "INVALID_SIGNATURE" : "INVALID_SIGNATURE",
        });
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

      const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
      const changeEnvelope: Array<{
        providerAccountId?: string;
        value: Record<string, unknown>;
      }> = [];

      for (const entry of entries) {
        const changes = Array.isArray((entry as Record<string, unknown>)?.changes)
          ? ((entry as Record<string, unknown>).changes as Array<Record<string, unknown>>)
          : [];

        for (const change of changes) {
          const value =
            change && typeof change.value === "object" && change.value
              ? (change.value as Record<string, unknown>)
              : null;

          if (!value) continue;

          const metadata =
            value.metadata && typeof value.metadata === "object"
              ? (value.metadata as Record<string, unknown>)
              : null;

          changeEnvelope.push({
            providerAccountId:
              typeof metadata?.phone_number_id === "string"
                ? metadata.phone_number_id
                : undefined,
            value,
          });
        }
      }

      if (changeEnvelope.length === 0) {
        ChannelObservabilityService.record({
          metric: "webhook.rejected",
          provider: "WHATSAPP",
          requestId: security.requestId,
          providerEventId: null,
          companyId: null,
          eventType: "WHATSAPP_WEBHOOK",
          outcome: "rejected",
          latencyMs: Date.now() - startedAt,
          safeErrorCode: "UNSUPPORTED_PAYLOAD_SHAPE",
        });
        await WebhookReplayService.recordSecurityEvent({
          provider: WebhookProvider.WHATSAPP,
          eventType: "SECURITY_TRUST_BOUNDARY_VIOLATION",
          requestId: security.requestId,
          signatureFingerprint: security.signatureFingerprint,
          payloadFingerprintSource: security.rawPayload,
          reason: "unsupported_payload_shape",
        });

        return sendResponse({
          res,
          statusCode: HTTP_STATUS.OK,
          message: "No inbound message found",
        });
      }

      const statusEvents: ChannelDeliveryEvent[] = [];
      const messageEvents: Array<ReturnType<typeof normalizeWhatsAppMessage>> = [];

      for (const envelope of changeEnvelope) {
        const statuses = Array.isArray(envelope.value.statuses)
          ? (envelope.value.statuses as Array<Record<string, unknown>>)
          : [];

        for (const status of statuses) {
          const normalizedStatus = normalizeWhatsAppStatus({
            ...status,
            providerAccountId: envelope.providerAccountId,
          });

          if (normalizedStatus) {
            statusEvents.push(normalizedStatus);
          } else {
            await WebhookReplayService.recordSecurityEvent({
              provider: WebhookProvider.WHATSAPP,
              eventType: "SECURITY_TRUST_BOUNDARY_VIOLATION",
              requestId: security.requestId,
              signatureFingerprint: security.signatureFingerprint,
              payloadFingerprintSource: security.rawPayload,
              reason: "invalid_status_payload",
              metadata: {
                providerAccountId: envelope.providerAccountId,
              },
            });
          }
        }

        const incomingMessages = Array.isArray(envelope.value.messages)
          ? (envelope.value.messages as Array<Record<string, unknown>>)
          : [];

        const contacts = Array.isArray(envelope.value.contacts)
          ? (envelope.value.contacts as Array<Record<string, unknown>>)
          : [];

        const customerName =
          typeof (contacts[0]?.profile as Record<string, unknown> | undefined)?.name === "string"
            ? String((contacts[0]?.profile as Record<string, unknown>).name)
            : "WhatsApp Customer";

        for (const incomingMessage of incomingMessages) {
          if (typeof incomingMessage.id !== "string" || typeof incomingMessage.from !== "string") {
            await WebhookReplayService.recordSecurityEvent({
              provider: WebhookProvider.WHATSAPP,
              eventType: "SECURITY_TRUST_BOUNDARY_VIOLATION",
              requestId: security.requestId,
              signatureFingerprint: security.signatureFingerprint,
              payloadFingerprintSource: security.rawPayload,
              reason: "invalid_message_payload",
              metadata: {
                providerAccountId: envelope.providerAccountId,
              },
            });
            continue;
          }

          messageEvents.push(
            normalizeWhatsAppMessage({
              messageId: incomingMessage.id,
              providerAccountId: envelope.providerAccountId,
              from: incomingMessage.from,
              customerName,
              content:
                typeof (incomingMessage.text as Record<string, unknown> | undefined)?.body === "string"
                  ? String((incomingMessage.text as Record<string, unknown>).body)
                  : "",
              timestamp:
                typeof incomingMessage.timestamp === "string"
                  ? incomingMessage.timestamp
                  : String(Math.floor(Date.now() / 1000)),
            })
          );
        }
      }

      statusEvents.sort((a, b) =>
        String(a.timestamp).localeCompare(String(b.timestamp)) ||
        a.externalMessageId.localeCompare(b.externalMessageId)
      );

      for (const status of statusEvents) {
        await ChannelService.processDeliveryEvent(status, {
          requestId: security.requestId,
          signatureFingerprint: security.signatureFingerprint,
          rawPayload: security.rawPayload,
        });
      }

      messageEvents.sort((a, b) =>
        String(a.timestamp).localeCompare(String(b.timestamp)) ||
        a.externalMessageId.localeCompare(b.externalMessageId)
      );

      for (const message of messageEvents) {
        await ChannelService.processIncomingMessage(message, {
          requestId: security.requestId,
          signatureFingerprint: security.signatureFingerprint,
          rawPayload: security.rawPayload,
        });
      }

      // TODO
      // Normalize provider payload
      // Process inbound messages
      // Process delivery events
      // Create conversations/messages
      // Emit realtime events

      ChannelObservabilityService.record({
        metric: "webhook.accepted",
        provider: "WHATSAPP",
        requestId: security.requestId,
        providerEventId:
          statusEvents[0]?.externalMessageId ?? messageEvents[0]?.externalMessageId ?? null,
        companyId: null,
        eventType: "WHATSAPP_WEBHOOK",
        outcome: "accepted",
        latencyMs: Date.now() - startedAt,
      });

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message:
          statusEvents.length > 0 && messageEvents.length === 0
            ? "Webhook status event received successfully"
            : "Webhook event received successfully",
      });
    }
  );
}
