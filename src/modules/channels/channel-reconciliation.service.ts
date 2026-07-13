import {
  ChannelDlqReason,
  ChannelDlqState,
  ChannelRetryState,
  ConversationChannel,
  MessageStatus,
  ReconciliationRunStatus,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { ChannelReliabilityService } from "./channel-reliability.service.js";
import { ChannelService } from "./channel.service.js";
import { ChannelObservabilityService } from "./channel-observability.service.js";

type ReconciliationSummary = {
  runId: string;
  status: ReconciliationRunStatus;
  scannedCount: number;
  updatedCount: number;
  createdDlqCount: number;
  errors: string[];
};

export class ChannelReconciliationService {
  static async runCompany(companyId: string): Promise<ReconciliationSummary> {
    const run = await prisma.reconciliationRun.create({
      data: {
        companyId,
        runType: "CHANNEL_RELIABILITY",
        status: ReconciliationRunStatus.STARTED,
      },
      select: { id: true },
    });

    await AuditLogService.record({
      companyId,
      action: "RECONCILIATION_STARTED",
      entityType: "RECONCILIATION_RUN",
      entityId: run.id,
      metadata: {
        runType: "CHANNEL_RELIABILITY",
      },
    });

    ChannelObservabilityService.record({
      metric: "operations.reconciliation_started",
      provider: "EMAIL",
      companyId,
      eventType: "CHANNEL_RELIABILITY",
      outcome: "scheduled",
    });

    let scannedCount = 0;
    let updatedCount = 0;
    let createdDlqCount = 0;
    const errors: string[] = [];

    try {
      const stalePending = await prisma.message.findMany({
        where: {
          companyId,
          sender: "AGENT",
          provider: {
            in: [ConversationChannel.WHATSAPP, ConversationChannel.EMAIL],
          },
          status: MessageStatus.PENDING,
          createdAt: { lte: ChannelReliabilityService.stalePendingCutoff },
        },
        select: {
          id: true,
          provider: true,
          companyId: true,
          conversationId: true,
          content: true,
        },
        take: 100,
      });

      scannedCount += stalePending.length;

      for (const message of stalePending) {
        if (
          message.provider !== ConversationChannel.WHATSAPP &&
          message.provider !== ConversationChannel.EMAIL
        ) {
          continue;
        }

        await ChannelReliabilityService.ensureRetryState({
          companyId: message.companyId,
          messageId: message.id,
          provider: message.provider,
        });

        await ChannelReliabilityService.scheduleImmediateRetry(
          message.id,
          message.companyId
        );

        updatedCount += 1;
      }

      const staleSent = await prisma.message.findMany({
        where: {
          companyId,
          sender: "AGENT",
          provider: {
            in: [ConversationChannel.WHATSAPP, ConversationChannel.EMAIL],
          },
          status: MessageStatus.SENT,
          createdAt: { lte: ChannelReliabilityService.staleSentCutoff },
        },
        select: {
          id: true,
          provider: true,
          companyId: true,
          conversationId: true,
          externalMessageId: true,
          content: true,
        },
        take: 100,
      });

      scannedCount += staleSent.length;

      for (const message of staleSent) {
        if (
          message.provider !== ConversationChannel.WHATSAPP &&
          message.provider !== ConversationChannel.EMAIL
        ) {
          continue;
        }

        await ChannelReliabilityService.moveToDlq({
          companyId: message.companyId,
          provider: message.provider,
          reason: ChannelDlqReason.DELIVERY_UNMATCHED,
          sourceEventType: "RECONCILIATION_STALE_SENT",
          payload: {
            messageId: message.id,
            conversationId: message.conversationId,
            externalMessageId: message.externalMessageId,
            content: message.content,
          },
          messageId: message.id,
          externalMessageId: message.externalMessageId ?? undefined,
          failureCode: "DELIVERY_UPDATE_MISSING",
          failureReason: "sent_message_missing_delivery_updates",
        });

        createdDlqCount += 1;
      }

      const dueRetries = await ChannelReliabilityService.getDueRetryStates(companyId);
      scannedCount += dueRetries.length;

      for (const state of dueRetries) {
        try {
          await ChannelService.retryOutboundMessage({
            companyId,
            messageId: state.messageId,
          });
          updatedCount += 1;
        } catch (error) {
          errors.push(
            `retry message ${state.messageId}: ${
              error instanceof Error ? error.message : "unknown_error"
            }`
          );
        }
      }

      const dueDlq = await ChannelReliabilityService.getReprocessableDlq(companyId);
      scannedCount += dueDlq.length;

      for (const dlqItem of dueDlq) {
        if (!dlqItem.messageId) continue;

        await prisma.channelDeadLetterItem.update({
          where: { id: dlqItem.id },
          data: { state: ChannelDlqState.REPROCESSING },
        });

        try {
          await ChannelService.retryOutboundMessage({
            companyId,
            messageId: dlqItem.messageId,
            force: true,
          });

          await ChannelReliabilityService.markDlqResolved(dlqItem.id);
          updatedCount += 1;
        } catch (error) {
          errors.push(
            `dlq reprocess ${dlqItem.id}: ${
              error instanceof Error ? error.message : "unknown_error"
            }`
          );

          await prisma.channelDeadLetterItem.update({
            where: { id: dlqItem.id },
            data: {
              state: ChannelDlqState.OPEN,
              retryCount: { increment: 1 },
              nextRetryAt: new Date(Date.now() + 5 * 60_000),
              lastFailedAt: new Date(),
            },
          });
        }
      }

      await prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: ReconciliationRunStatus.COMPLETED,
          scannedCount,
          updatedCount,
          createdDlqCount,
          completedAt: new Date(),
          metadata: {
            errors,
          },
        },
      });

      await AuditLogService.record({
        companyId,
        action: "RECONCILIATION_COMPLETED",
        entityType: "RECONCILIATION_RUN",
        entityId: run.id,
        metadata: {
          scannedCount,
          updatedCount,
          createdDlqCount,
          errorCount: errors.length,
        },
      });

      ChannelObservabilityService.record({
        metric: "operations.reconciliation_completed",
        provider: "EMAIL",
        companyId,
        eventType: "CHANNEL_RELIABILITY",
        outcome: "completed",
      });

      return {
        runId: run.id,
        status: ReconciliationRunStatus.COMPLETED,
        scannedCount,
        updatedCount,
        createdDlqCount,
        errors,
      };
    } catch (error) {
      await prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          status: ReconciliationRunStatus.FAILED,
          scannedCount,
          updatedCount,
          createdDlqCount,
          completedAt: new Date(),
          errorMessage:
            error instanceof Error ? error.message : "reconciliation_failed",
          metadata: {
            errors,
          },
        },
      });

      ChannelObservabilityService.record({
        metric: "operations.reconciliation_failed",
        provider: "EMAIL",
        companyId,
        eventType: "CHANNEL_RELIABILITY",
        outcome: "failure",
        safeErrorCode: "RECONCILIATION_FAILED",
      });

      throw error;
    }
  }
}
