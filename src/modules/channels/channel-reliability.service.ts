import { randomUUID } from "node:crypto";
import {
  ChannelDlqReason,
  ChannelDlqState,
  ChannelRetryState,
  ConversationChannel,
  MessageStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { AppError } from "@/core/errors/app-error.js";
import { mapMessage } from "@/modules/messages/message.mapper.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { getIO } from "@/socket/socket.server.js";
import { ChannelObservabilityService } from "./channel-observability.service.js";

type RetryProvider = "WHATSAPP" | "EMAIL";

type RetryClassification = {
  retryable: boolean;
  code: string;
  reason: string;
  httpStatus?: number;
};

type RetryFailureInput = {
  companyId: string;
  messageId: string;
  provider: RetryProvider;
  classification: RetryClassification;
  lockToken: string;
  sourceEventType: string;
  payload: Prisma.InputJsonValue;
  failureMeta?: Prisma.InputJsonValue;
};

const RETRY_BASE_DELAY_MS = 15_000;
const RETRY_MAX_DELAY_MS = 15 * 60_000;
const RETRY_LOCK_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DELIVERY_STALE_MINUTES = 30;
const PENDING_STALE_MINUTES = 5;
const DUE_RETRY_BATCH_SIZE = 50;

const emitMessageStatus = async (messageId: string) => {
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) return;
  getIO().to(`conversation:${message.conversationId}`).emit(
    "message_status_updated",
    mapMessage(message)
  );
};

const providerPrefix = (provider: RetryProvider) =>
  provider === "WHATSAPP" ? "WHATSAPP" : "EMAIL";

const toJsonValue = (value: unknown): Prisma.InputJsonValue => {
  if (value === null) return "[NULL]";

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (typeof value === "object") {
    const result: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toJsonValue(nested);
    }
    return result;
  }

  return String(value);
};

const calculateBackoffWithJitter = (attempt: number) => {
  const exponential = Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1)
  );
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exponential * 0.2)));
  return exponential + jitter;
};

export class ChannelReliabilityService {
  static get stalePendingCutoff() {
    return new Date(Date.now() - PENDING_STALE_MINUTES * 60_000);
  }

  static get staleSentCutoff() {
    return new Date(Date.now() - DELIVERY_STALE_MINUTES * 60_000);
  }

  static classifyOutboundFailure(
    provider: RetryProvider,
    error: unknown
  ): RetryClassification {
    if (error instanceof AppError) {
      const details = (error.details ?? {}) as Record<string, unknown>;
      const providerStatus =
        typeof details.providerStatus === "number" ? details.providerStatus : undefined;

      if (provider === "WHATSAPP") {
        if (error.code === "WHATSAPP_PROVIDER_NOT_CONFIGURED") {
          return {
            retryable: false,
            code: "WHATSAPP_PROVIDER_NOT_CONFIGURED",
            reason: "provider_not_configured",
          };
        }

        if (error.code === "WHATSAPP_SEND_FAILED") {
          const failureReason = String(details.reason ?? "");
          if (failureReason === "PROVIDER_UNAVAILABLE") {
            return {
              retryable: true,
              code: "WHATSAPP_PROVIDER_UNAVAILABLE",
              reason: "provider_unavailable",
              httpStatus: providerStatus,
            };
          }

          if (providerStatus === 429 || (providerStatus !== undefined && providerStatus >= 500)) {
            return {
              retryable: true,
              code: "WHATSAPP_PROVIDER_TRANSIENT",
              reason: "provider_transient_status",
              httpStatus: providerStatus,
            };
          }

          return {
            retryable: false,
            code: "WHATSAPP_PERMANENT_REJECTION",
            reason: "provider_rejected",
            httpStatus: providerStatus,
          };
        }
      }

      if (provider === "EMAIL") {
        if (error.code === "EMAIL_PROVIDER_NOT_CONFIGURED") {
          return {
            retryable: false,
            code: "EMAIL_PROVIDER_NOT_CONFIGURED",
            reason: "provider_not_configured",
          };
        }

        if (error.code === "EMAIL_PROVIDER_UNAVAILABLE") {
          return {
            retryable: true,
            code: "EMAIL_PROVIDER_UNAVAILABLE",
            reason: "provider_unavailable",
            httpStatus: providerStatus,
          };
        }

        if (error.code === "EMAIL_SEND_FAILED") {
          if (providerStatus === 429 || (providerStatus !== undefined && providerStatus >= 500)) {
            return {
              retryable: true,
              code: "EMAIL_PROVIDER_TRANSIENT",
              reason: "provider_transient_status",
              httpStatus: providerStatus,
            };
          }

          return {
            retryable: false,
            code: "EMAIL_PERMANENT_REJECTION",
            reason: "provider_rejected",
            httpStatus: providerStatus,
          };
        }
      }
    }

    return {
      retryable: true,
      code: `${providerPrefix(provider)}_UNKNOWN_TRANSIENT`,
      reason: "unknown_transient_failure",
    };
  }

  static async ensureRetryState(input: {
    companyId: string;
    messageId: string;
    provider: RetryProvider;
    maxAttempts?: number;
  }) {
    return prisma.messageRetryState.upsert({
      where: { messageId: input.messageId },
      create: {
        companyId: input.companyId,
        messageId: input.messageId,
        provider: input.provider,
        state: ChannelRetryState.PENDING,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      },
      update: {
        provider: input.provider,
        companyId: input.companyId,
        maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      },
    });
  }

  static async acquireSendLock(messageId: string, force = false) {
    const lockToken = randomUUID();
    const now = new Date();
    const staleLockCutoff = new Date(now.getTime() - RETRY_LOCK_TIMEOUT_MS);

    const stateFilter = force
      ? {
          in: [
            ChannelRetryState.PENDING,
            ChannelRetryState.RETRY_SCHEDULED,
            ChannelRetryState.FAILED,
            ChannelRetryState.PROCESSING,
          ],
        }
      : {
          in: [ChannelRetryState.RETRY_SCHEDULED, ChannelRetryState.PROCESSING],
        };

    const updated = await prisma.messageRetryState.updateMany({
      where: {
        messageId,
        state: stateFilter,
        OR: [
          { state: { not: ChannelRetryState.PROCESSING } },
          { lockedAt: { lt: staleLockCutoff } },
        ],
        ...(force
          ? {}
          : {
              OR: [
                { nextAttemptAt: null },
                { nextAttemptAt: { lte: now } },
              ],
            }),
      },
      data: {
        state: ChannelRetryState.PROCESSING,
        lockToken,
        lockedAt: now,
        lastAttemptAt: now,
      },
    });

    if (updated.count === 0) {
      return null;
    }

    return lockToken;
  }

  static async markRetrySuccess(messageId: string, lockToken: string) {
    await prisma.messageRetryState.updateMany({
      where: {
        messageId,
        lockToken,
      },
      data: {
        state: ChannelRetryState.SUCCEEDED,
        nextAttemptAt: null,
        lockToken: null,
        lockedAt: null,
        lastFailureCode: null,
        lastFailureReason: null,
        lastHttpStatus: null,
      },
    });
  }

  static async handleRetryFailure(input: RetryFailureInput) {
    const retryState = await prisma.messageRetryState.findUnique({
      where: { messageId: input.messageId },
      select: {
        id: true,
        attemptCount: true,
        maxAttempts: true,
      },
    });

    if (!retryState) {
      return;
    }

    const nextAttempt = retryState.attemptCount + 1;
    const exhausted = nextAttempt >= retryState.maxAttempts;

    if (input.classification.retryable && !exhausted) {
      const delayMs = calculateBackoffWithJitter(nextAttempt);
      const nextAttemptAt = new Date(Date.now() + delayMs);

      await prisma.messageRetryState.updateMany({
        where: {
          messageId: input.messageId,
          lockToken: input.lockToken,
        },
        data: {
          attemptCount: nextAttempt,
          state: ChannelRetryState.RETRY_SCHEDULED,
          nextAttemptAt,
          lockToken: null,
          lockedAt: null,
          lastFailureAt: new Date(),
          lastFailureCode: input.classification.code,
          lastFailureReason: input.classification.reason,
          lastHttpStatus: input.classification.httpStatus ?? null,
        },
      });

      await prisma.message.update({
        where: { id: input.messageId },
        data: {
          status: MessageStatus.PENDING,
          provider: input.provider,
        },
      });

      await emitMessageStatus(input.messageId);

      await AuditLogService.record({
        companyId: input.companyId,
        action: `${providerPrefix(input.provider)}_RETRY_SCHEDULED`,
        entityType: "MESSAGE",
        entityId: input.messageId,
        metadata: {
          attemptCount: nextAttempt,
          maxAttempts: retryState.maxAttempts,
          nextAttemptAt: nextAttemptAt.toISOString(),
          failureCode: input.classification.code,
          failureReason: input.classification.reason,
          sourceEventType: input.sourceEventType,
        },
      });

      ChannelObservabilityService.record({
        metric: "messaging.retry_scheduled",
        provider: providerPrefix(input.provider),
        companyId: input.companyId,
        providerEventId: null,
        eventType: input.sourceEventType,
        outcome: "scheduled",
        safeErrorCode: input.classification.code,
      });

      return;
    }

    await prisma.messageRetryState.updateMany({
      where: {
        messageId: input.messageId,
        lockToken: input.lockToken,
      },
      data: {
        attemptCount: nextAttempt,
        state: ChannelRetryState.EXHAUSTED,
        nextAttemptAt: null,
        lockToken: null,
        lockedAt: null,
        lastFailureAt: new Date(),
        lastFailureCode: input.classification.code,
        lastFailureReason: input.classification.reason,
        lastHttpStatus: input.classification.httpStatus ?? null,
      },
    });

    await AuditLogService.record({
      companyId: input.companyId,
      action: `${providerPrefix(input.provider)}_RETRY_EXHAUSTED`,
      entityType: "MESSAGE",
      entityId: input.messageId,
      metadata: {
        attemptCount: nextAttempt,
        maxAttempts: retryState.maxAttempts,
        failureCode: input.classification.code,
        failureReason: input.classification.reason,
        sourceEventType: input.sourceEventType,
      },
    });

    ChannelObservabilityService.record({
      metric: "messaging.retry_exhausted",
      provider: providerPrefix(input.provider),
      companyId: input.companyId,
      providerEventId: null,
      eventType: input.sourceEventType,
      outcome: "failure",
      safeErrorCode: input.classification.code,
    });

    await this.moveToDlq({
      companyId: input.companyId,
      provider: input.provider,
      reason: ChannelDlqReason.RETRY_EXHAUSTED,
      sourceEventType: input.sourceEventType,
      payload: input.payload,
      messageId: input.messageId,
      failureCode: input.classification.code,
      failureReason: input.classification.reason,
      failureMeta: input.failureMeta,
    });

    await prisma.message.update({
      where: { id: input.messageId },
      data: {
        status: MessageStatus.FAILED,
        provider: input.provider,
      },
    });

    await emitMessageStatus(input.messageId);
  }

  static async moveToDlq(input: {
    companyId?: string | null;
    provider: RetryProvider;
    reason: ChannelDlqReason;
    sourceEventType: string;
    payload: Prisma.InputJsonValue;
    messageId?: string;
    externalMessageId?: string;
    providerAccountId?: string;
    failureCode?: string;
    failureReason: string;
    failureMeta?: Prisma.InputJsonValue;
    nextRetryAt?: Date | null;
  }) {
    const existing = await prisma.channelDeadLetterItem.findFirst({
      where: {
        state: ChannelDlqState.OPEN,
        provider: input.provider,
        reason: input.reason,
        messageId: input.messageId ?? null,
        externalMessageId: input.externalMessageId ?? null,
      },
      select: {
        id: true,
        retryCount: true,
      },
    });

    if (existing) {
      await prisma.channelDeadLetterItem.update({
        where: { id: existing.id },
        data: {
          lastFailedAt: new Date(),
          retryCount: existing.retryCount + 1,
          failureCode: input.failureCode,
          failureReason: input.failureReason,
          failureMeta: input.failureMeta,
          payload: input.payload,
          nextRetryAt: input.nextRetryAt ?? null,
        },
      });
    } else {
      await prisma.channelDeadLetterItem.create({
        data: {
          companyId: input.companyId ?? null,
          provider: input.provider,
          reason: input.reason,
          sourceEventType: input.sourceEventType,
          payload: input.payload,
          messageId: input.messageId,
          externalMessageId: input.externalMessageId,
          providerAccountId: input.providerAccountId,
          failureCode: input.failureCode,
          failureReason: input.failureReason,
          failureMeta: input.failureMeta,
          nextRetryAt: input.nextRetryAt ?? null,
        },
      });
    }

    if (input.companyId && input.messageId) {
      await AuditLogService.record({
        companyId: input.companyId,
        action: `${providerPrefix(input.provider)}_MOVED_TO_DLQ`,
        entityType: "MESSAGE",
        entityId: input.messageId,
        metadata: {
          reason: input.reason,
          sourceEventType: input.sourceEventType,
          failureCode: input.failureCode,
          failureReason: input.failureReason,
          externalMessageId: input.externalMessageId,
        },
      });

      ChannelObservabilityService.record({
        metric: "messaging.dlq_created",
        provider: providerPrefix(input.provider),
        companyId: input.companyId,
        providerEventId: input.externalMessageId ?? null,
        eventType: input.sourceEventType,
        outcome: "failure",
        safeErrorCode: input.failureCode ?? null,
      });
    }
  }

  static async markDlqResolved(dlqId: string) {
    await prisma.channelDeadLetterItem.updateMany({
      where: {
        id: dlqId,
        state: {
          in: [ChannelDlqState.OPEN, ChannelDlqState.REPROCESSING],
        },
      },
      data: {
        state: ChannelDlqState.RESOLVED,
        processedAt: new Date(),
        nextRetryAt: null,
      },
    });
  }

  static async getDueRetryStates(companyId: string) {
    return prisma.messageRetryState.findMany({
      where: {
        companyId,
        state: ChannelRetryState.RETRY_SCHEDULED,
        nextAttemptAt: {
          lte: new Date(),
        },
      },
      orderBy: [{ nextAttemptAt: "asc" }, { updatedAt: "asc" }],
      take: DUE_RETRY_BATCH_SIZE,
      select: {
        messageId: true,
      },
    });
  }

  static async getReprocessableDlq(companyId: string) {
    return prisma.channelDeadLetterItem.findMany({
      where: {
        companyId,
        state: ChannelDlqState.OPEN,
        reason: {
          in: [
            ChannelDlqReason.RETRY_EXHAUSTED,
            ChannelDlqReason.PROVIDER_PROCESSING_FAILURE,
          ],
        },
        messageId: {
          not: null,
        },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
      },
      orderBy: [{ updatedAt: "asc" }],
      take: DUE_RETRY_BATCH_SIZE,
      select: {
        id: true,
        messageId: true,
      },
    });
  }

  static async scheduleImmediateRetry(messageId: string, companyId: string) {
    await prisma.messageRetryState.updateMany({
      where: {
        messageId,
        companyId,
      },
      data: {
        state: ChannelRetryState.RETRY_SCHEDULED,
        nextAttemptAt: new Date(),
        lockToken: null,
        lockedAt: null,
      },
    });
  }

  static toJsonValue(value: unknown): Prisma.InputJsonValue {
    return toJsonValue(value);
  }
}
