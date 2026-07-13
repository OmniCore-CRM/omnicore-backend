import { createHash } from "node:crypto";
import {
  Prisma,
  WebhookProvider,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { ChannelObservabilityService } from "./channel-observability.service.js";

type ReplayClaimInput = {
  provider: WebhookProvider;
  eventType: string;
  providerEventId?: string | null;
  companyId?: string | null;
  requestId?: string | null;
  signatureFingerprint?: string | null;
  payloadFingerprintSource: string;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

type SecurityEventInput = {
  provider: WebhookProvider;
  eventType: string;
  companyId?: string | null;
  providerEventId?: string | null;
  requestId?: string | null;
  signatureFingerprint?: string | null;
  payloadFingerprintSource: string;
  reason: string;
  metadata?: Prisma.InputJsonValue | null;
};

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const normalize = (value: string | null | undefined) =>
  value?.trim() || null;

const buildIdentityKey = (input: {
  provider: WebhookProvider;
  eventType: string;
  companyId?: string | null;
  providerEventId?: string | null;
  signatureFingerprint?: string | null;
  payloadFingerprint: string;
}) => {
  const base = [
    input.provider,
    input.eventType,
    input.companyId ?? "global",
    input.providerEventId ?? "no-provider-event-id",
    input.signatureFingerprint ?? "no-signature",
    input.payloadFingerprint,
  ].join("|");

  return sha256(base);
};

const replayAuditMetadata = (input: {
  provider: WebhookProvider;
  eventType: string;
  companyId?: string | null;
  providerEventId?: string | null;
  requestId?: string | null;
  reason?: string | null;
  payloadFingerprint: string;
}) => ({
  provider: input.provider,
  eventType: input.eventType,
  providerEventId: input.providerEventId,
  requestId: input.requestId,
  reason: input.reason,
  payloadFingerprint: input.payloadFingerprint,
});

const recordReplayRejectedAudit = async (input: {
  provider: WebhookProvider;
  eventType: string;
  companyId?: string | null;
  providerEventId?: string | null;
  requestId?: string | null;
  reason?: string | null;
  payloadFingerprint: string;
}) => {
  if (!input.companyId) {
    return;
  }

  await AuditLogService.record({
    companyId: input.companyId,
    action: `${input.provider}_REPLAY_REJECTED`,
    entityType: "WEBHOOK_EVENT",
    entityId: input.providerEventId ?? input.payloadFingerprint,
    metadata: replayAuditMetadata(input),
  });
};

export class WebhookReplayService {
  static payloadFingerprint(rawPayload: string) {
    return sha256(rawPayload);
  }

  static signatureFingerprint(signature: string | null | undefined) {
    const normalized = normalize(signature);
    if (!normalized) return null;
    return sha256(normalized);
  }

  static async claimEvent(
    input: ReplayClaimInput,
    tx?: Prisma.TransactionClient | PrismaClient
  ) {
    const providerEventId = normalize(input.providerEventId);
    const companyId = normalize(input.companyId);
    const requestId = normalize(input.requestId);
    const signatureFingerprint = normalize(input.signatureFingerprint);
    const payloadFingerprint = sha256(input.payloadFingerprintSource);

    const identityKey = buildIdentityKey({
      provider: input.provider,
      eventType: input.eventType,
      companyId,
      providerEventId,
      signatureFingerprint,
      payloadFingerprint,
    });

    const db = tx ?? prisma;

    try {
      const ledger = await db.webhookReplayLedger.create({
        data: {
          provider: input.provider,
          eventType: input.eventType,
          identityKey,
          companyId,
          providerEventId,
          signatureFingerprint,
          payloadFingerprint,
          firstRequestId: requestId,
          lastRequestId: requestId,
          lastReason: input.reason ?? null,
          metadata: input.metadata ?? undefined,
        },
      });

      return {
        accepted: true as const,
        ledger,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await db.webhookReplayLedger.findUnique({
          where: {
            identityKey,
          },
        });

        if (existing) {
          await db.webhookReplayLedger.update({
            where: {
              id: existing.id,
            },
            data: {
              lastSeenAt: new Date(),
              lastRequestId: requestId,
              seenCount: {
                increment: 1,
              },
              lastReason: input.reason ?? existing.lastReason,
            },
          });
        }

        await recordReplayRejectedAudit({
          provider: input.provider,
          eventType: input.eventType,
          companyId,
          providerEventId,
          requestId,
          reason: input.reason,
          payloadFingerprint,
        });

        ChannelObservabilityService.record({
          metric: "webhook.replay_rejected",
          provider: input.provider,
          companyId,
          requestId,
          providerEventId,
          eventType: input.eventType,
          outcome: "rejected",
          safeErrorCode: "REPLAY_DETECTED",
        });

        return {
          accepted: false as const,
          reason: "REPLAY_DETECTED" as const,
          identityKey,
        };
      }

      throw error;
    }
  }

  static async recordSecurityEvent(input: SecurityEventInput) {
    const payloadFingerprint = sha256(input.payloadFingerprintSource);
    const companyId = normalize(input.companyId);
    const providerEventId = normalize(input.providerEventId);
    const requestId = normalize(input.requestId);
    const signatureFingerprint = normalize(input.signatureFingerprint);

    const entropy = `${Date.now()}|${Math.random()}`;
    const identityKey = sha256(
      [
        input.provider,
        input.eventType,
        companyId ?? "global",
        providerEventId ?? payloadFingerprint,
        input.reason,
        entropy,
      ].join("|")
    );

    await prisma.webhookReplayLedger.create({
      data: {
        provider: input.provider,
        eventType: input.eventType,
        identityKey,
        companyId,
        providerEventId,
        signatureFingerprint,
        payloadFingerprint,
        firstRequestId: requestId,
        lastRequestId: requestId,
        lastReason: input.reason,
        metadata: input.metadata ?? undefined,
      },
    });
  }
}
