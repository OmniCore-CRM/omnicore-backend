import type { IncomingChannelMessage, ChannelDeliveryEvent } from "./channel.types.js";
import {
  ConversationChannel,
  ChannelDlqReason,
  MessageSender,
  MessageStatus,
  ProviderAccountStatus,
  Prisma,
  WebhookProvider,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { getIO } from "@/socket/socket.server.js";
import axios from "axios";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { mapMessage } from "@/modules/messages/message.mapper.js";
import { mapConversation } from "@/modules/conversations/conversation.mapper.js";
import { env } from "@/config/env.js";
import { resolveWhatsAppIngestionCompanyId } from "@/core/utils/tenant-resolution.js";
import { AssignmentRuleService } from "@/modules/assignment-rules/assignment-rule.service.js";
import { EmailService } from "@/modules/email/email.service.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { WebhookReplayService } from "./webhook-replay.service.js";
import { ChannelReliabilityService } from "./channel-reliability.service.js";
import { ChannelObservabilityService } from "./channel-observability.service.js";
import {
  evidenceSourceFromIds,
  maskSensitiveId,
  normalizeE164Phone,
} from "./provider-evidence.js";

const WHATSAPP_SEND_FAILED_MESSAGE =
  "WhatsApp message failed. The recipient may be invalid, not allowed for this test number, or outside the messaging window.";

const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

type WhatsAppTemplateInput = {
  name: string;
  languageCode?: string;
  components?: Prisma.InputJsonValue;
};

type WhatsAppProviderReadiness = {
  configured: boolean;
  productionReady: boolean;
  isTestNumber: boolean;
  phoneNumberIdHint: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  codeVerificationStatus: string | null;
  actionableErrors: string[];
};

const providerReadinessCache = new Map<
  string,
  { expiresAt: number; value: WhatsAppProviderReadiness }
>();

const parseWhatsAppTemplate = (metadata: Prisma.JsonValue | null) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const rawTemplate =
    (metadata as Record<string, unknown>).whatsappTemplate ??
    (metadata as Record<string, unknown>).template;

  if (!rawTemplate || typeof rawTemplate !== "object" || Array.isArray(rawTemplate)) {
    return null;
  }

  const template = rawTemplate as Record<string, unknown>;
  if (typeof template.name !== "string" || !template.name.trim()) {
    return null;
  }

  return {
    name: template.name.trim(),
    languageCode:
      typeof template.languageCode === "string" && template.languageCode.trim()
        ? template.languageCode.trim()
        : "en_US",
    components:
      Array.isArray(template.components) ||
      (template.components && typeof template.components === "object")
        ? (template.components as Prisma.InputJsonValue)
        : undefined,
  } satisfies WhatsAppTemplateInput;
};

const buildTemplatePayload = (template: WhatsAppTemplateInput) => {
  const payload: {
    messaging_product: "whatsapp";
    type: "template";
    template: {
      name: string;
      language: { code: string };
      components?: Prisma.InputJsonValue;
    };
  } = {
    messaging_product: "whatsapp",
    type: "template",
    template: {
      name: template.name,
      language: { code: template.languageCode ?? "en_US" },
    },
  };

  if (template.components) {
    payload.template.components = template.components;
  }

  return payload;
};

type SafeProviderFailure = {
  provider: "WHATSAPP";
  reason: "PROVIDER_REJECTED" | "PROVIDER_UNAVAILABLE";
  providerStatus?: number;
  providerCode?: string | number;
  providerType?: string;
  fbtraceId?: string;
};

const normalizeWhatsAppProviderFailure = (
  error: unknown
): SafeProviderFailure => {
  if (!axios.isAxiosError(error)) {
    return {
      provider: "WHATSAPP",
      reason: "PROVIDER_UNAVAILABLE",
    };
  }

  const responseData = error.response?.data as
    | {
        error?: {
          code?: string | number;
          type?: string;
          fbtrace_id?: string;
        };
      }
    | undefined;

  return {
    provider: "WHATSAPP",
    reason: "PROVIDER_REJECTED",
    providerStatus: error.response?.status,
    providerCode: responseData?.error?.code,
    providerType: responseData?.error?.type,
    fbtraceId: responseData?.error?.fbtrace_id,
  };
};

const logWhatsAppProviderFailure = (
  context: {
    companyId: string;
    conversationId: string;
    messageId: string;
  },
  failure: SafeProviderFailure
) => {
  console.error("WhatsApp provider send failed", {
    ...context,
    ...failure,
  });
};

const messageStatusRank: Record<MessageStatus, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
};

const emitMessageStatusUpdated = (message: Awaited<ReturnType<typeof prisma.message.update>>) => {
  const io = getIO();

  io.to(`conversation:${message.conversationId}`).emit(
    "message_status_updated",
    mapMessage(message)
  );
};

export class ChannelService {
  static async getProviderReadiness(companyId: string) {
    return {
      whatsapp: await this.getWhatsAppProviderReadiness(companyId),
      email: await EmailService.getProviderReadiness(companyId),
    };
  }

  static async getWhatsAppProviderReadiness(
    companyId: string
  ): Promise<WhatsAppProviderReadiness> {
    const cacheKey = `${companyId}:${env.WHATSAPP_PHONE_NUMBER_ID ?? ""}`;
    const now = Date.now();
    const cached = providerReadinessCache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const account = await prisma.whatsAppAccount.findFirst({
      where: { companyId, status: ProviderAccountStatus.ACTIVE },
      select: { phoneNumberId: true, displayPhoneNumber: true },
    });

    const errors: string[] = [];

    if (!account) {
      errors.push("No active WhatsApp account is configured for this company.");
    }

    if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN) {
      errors.push(
        "WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN must be configured in backend environment."
      );
    }

    if (
      account &&
      env.WHATSAPP_PHONE_NUMBER_ID &&
      account.phoneNumberId !== env.WHATSAPP_PHONE_NUMBER_ID
    ) {
      errors.push(
        "Configured WhatsApp phone number does not match the active tenant mapping."
      );
    }

    let displayPhoneNumber: string | null = account?.displayPhoneNumber ?? null;
    let verifiedName: string | null = null;
    let qualityRating: string | null = null;
    let codeVerificationStatus: string | null = null;
    let isTestNumber = false;

    if (errors.length === 0 && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN) {
      try {
        const response = await axios.get(
          `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_NUMBER_ID}`,
          {
            params: {
              fields:
                "display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type",
            },
            headers: {
              Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
            },
          }
        );

        displayPhoneNumber =
          typeof response.data?.display_phone_number === "string"
            ? response.data.display_phone_number
            : displayPhoneNumber;
        verifiedName =
          typeof response.data?.verified_name === "string"
            ? response.data.verified_name
            : null;
        qualityRating =
          typeof response.data?.quality_rating === "string"
            ? response.data.quality_rating
            : null;
        codeVerificationStatus =
          typeof response.data?.code_verification_status === "string"
            ? response.data.code_verification_status
            : null;

        isTestNumber =
          (verifiedName?.toLowerCase().includes("test number") ?? false) ||
          codeVerificationStatus === "NOT_VERIFIED";
      } catch {
        errors.push(
          "Could not verify WhatsApp number readiness from Meta API. Check token scopes and phone-number permissions."
        );
      }
    }

    if (isTestNumber) {
      errors.push(
        "Active WhatsApp sender is a Meta test number. It is not production-ready for real delivery proofs."
      );
    }

    const productionReady = errors.length === 0 && !isTestNumber;

    const readiness: WhatsAppProviderReadiness = {
      configured: errors.length === 0,
      productionReady,
      isTestNumber,
      phoneNumberIdHint: maskSensitiveId(env.WHATSAPP_PHONE_NUMBER_ID ?? account?.phoneNumberId),
      displayPhoneNumber,
      verifiedName,
      qualityRating,
      codeVerificationStatus,
      actionableErrors: errors,
    };

    providerReadinessCache.set(cacheKey, {
      value: readiness,
      expiresAt: Date.now() + 5 * 60_000,
    });

    return readiness;
  }

  // ===== Process inbound provider message =====
  static async processIncomingMessage(
    payload: IncomingChannelMessage,
    context?: {
      requestId?: string;
      signatureFingerprint?: string | null;
      rawPayload?: string;
    }
  ) {
    let companyId: string;

    try {
      companyId = await resolveWhatsAppIngestionCompanyId(payload.providerAccountId);
    } catch (error) {
      await WebhookReplayService.recordSecurityEvent({
        provider: WebhookProvider.WHATSAPP,
        eventType: "SECURITY_INVALID_TENANT_RESOLUTION",
        providerEventId: payload.externalMessageId,
        requestId: context?.requestId,
        signatureFingerprint: context?.signatureFingerprint ?? null,
        payloadFingerprintSource:
          context?.rawPayload ??
          JSON.stringify({
            externalMessageId: payload.externalMessageId,
            providerAccountId: payload.providerAccountId,
            status: null,
          }),
        reason:
          error instanceof AppError ? error.message : "tenant_resolution_failed",
        metadata: {
          providerAccountId: payload.providerAccountId,
        },
      });
      throw error;
    }

    const replayClaim = await WebhookReplayService.claimEvent({
      provider: WebhookProvider.WHATSAPP,
      eventType: "MESSAGE_RECEIVED",
      providerEventId: payload.externalMessageId,
      companyId,
      requestId: context?.requestId,
      signatureFingerprint: context?.signatureFingerprint ?? null,
      payloadFingerprintSource:
        context?.rawPayload ??
        JSON.stringify({
          externalMessageId: payload.externalMessageId,
          externalUserId: payload.externalUserId,
          content: payload.content,
          timestamp: payload.timestamp,
          providerAccountId: payload.providerAccountId,
        }),
      reason: "message_ingestion",
      metadata: {
        providerAccountId: payload.providerAccountId,
      },
    });

    if (!replayClaim.accepted) {
      return;
    }

    const evidenceSource = evidenceSourceFromIds(payload.externalMessageId);

    if (evidenceSource === "SIMULATED") {
      await AuditLogService.record({
        companyId,
        action: "WHATSAPP_SIMULATED_EVENT_IGNORED",
        entityType: "WEBHOOK_EVENT",
        entityId: payload.externalMessageId,
        metadata: {
          reason: "simulated_evidence",
          providerAccountId: payload.providerAccountId,
        },
      });
      return;
    }

    const existingMessage = await prisma.message.findFirst({
      where: {
        companyId,
        provider: ConversationChannel.WHATSAPP,
        externalMessageId: payload.externalMessageId,
      },
    });

    if (existingMessage) {
      await AuditLogService.record({
        companyId,
        action: "WHATSAPP_WEBHOOK_DUPLICATE_IGNORED",
        entityType: "MESSAGE",
        entityId: existingMessage.id,
        metadata: {
          externalMessageId: payload.externalMessageId,
          providerAccountId: payload.providerAccountId,
        },
      });
      return;
    }

    // Track whether conversation was newly created
    let isNewConversation = false;

    // Process CRM flow atomically
    const result = await prisma.$transaction(async (tx) => {
      // Find existing customer by phone
      let customer =
        await tx.customer.findFirst({
          where: {
            companyId,

            phone:
              payload.customerPhone || payload.externalUserId,
          },
        });

      // Create customer if not found
      if (!customer) {
        customer =
          await tx.customer.create({
            data: {
              companyId,

              firstName:
                payload.customerName ||
                "Unknown",

              lastName: "Customer",

              phone:
                payload.customerPhone ||
                payload.externalUserId,
            },
          });
      }

      // Find existing conversation
      let conversation =
        await tx.conversation.findFirst({
          where: {
            companyId,

            customerId:
              customer.id,

            channel:
              ConversationChannel.WHATSAPP,
          },
        });

      // Create conversation if not found
      if (!conversation) {
        conversation =
          await tx.conversation.create({
            data: {
              companyId,

              customerId:
                customer.id,

              channel:
                ConversationChannel.WHATSAPP,
            },
          });

        isNewConversation = true;
      }

      // Create CRM message
      const message =
        await tx.message.create({
          data: {
            companyId,
            conversationId: conversation.id,
            sender: MessageSender.CUSTOMER,
            content: payload.content,
            status: MessageStatus.DELIVERED,
            externalMessageId: payload.externalMessageId,
            provider: ConversationChannel.WHATSAPP,
          },
        });

      // Update conversation activity timestamp
      await tx.conversation.update({
        where: {
          id: conversation.id,
        },

        data: {
          updatedAt: new Date(),
        },
      });

      return {
        customer,
        conversation,
        message,
      };
    }).catch(async (error) => {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const duplicate = await prisma.message.findFirst({
          where: {
            companyId,
            provider: ConversationChannel.WHATSAPP,
            externalMessageId: payload.externalMessageId,
          },
          include: { conversation: true },
        });

        return duplicate
          ? { customer: null, conversation: duplicate.conversation, message: duplicate }
          : null;
      }

      throw error;
    });

    if (!result || !result.customer) {
      return;
    }

    await AuditLogService.record({
      companyId,
      action: "WHATSAPP_WEBHOOK_MESSAGE_RECEIVED",
      entityType: "MESSAGE",
      entityId: result.message.id,
      metadata: {
        conversationId: result.conversation.id,
        externalMessageId: payload.externalMessageId,
        providerAccountId: payload.providerAccountId,
        isNewConversation,
      },
    });

    // Emit realtime inbox update
    const io = getIO();

    io.to(
      `conversation:${result.conversation.id}`
    ).emit("new_message", mapMessage(result.message));

    // Emit new conversation event only for newly created conversations
    if (isNewConversation) {
      const conversationWithRelations = {
        ...result.conversation,
        customer: result.customer,
        messages: [result.message],
      };
      io.to(`company:${companyId}`).emit(
        "new_conversation",
        mapConversation(conversationWithRelations)
      );
      await AssignmentRuleService.applyConversationRules({
        companyId,
        conversationId: result.conversation.id,
        channel: result.conversation.channel,
      });
    }
  }

  // ===== Process delivery/read events =====
  static async processDeliveryEvent(
    payload: ChannelDeliveryEvent,
    context?: {
      requestId?: string;
      signatureFingerprint?: string | null;
      rawPayload?: string;
    }
  ) {
    let companyId: string;

    try {
      companyId = await resolveWhatsAppIngestionCompanyId(payload.providerAccountId);
    } catch (error) {
      await WebhookReplayService.recordSecurityEvent({
        provider: WebhookProvider.WHATSAPP,
        eventType: "SECURITY_INVALID_TENANT_RESOLUTION",
        providerEventId: payload.externalMessageId,
        requestId: context?.requestId,
        signatureFingerprint: context?.signatureFingerprint ?? null,
        payloadFingerprintSource:
          context?.rawPayload ??
          JSON.stringify({
            externalMessageId: payload.externalMessageId,
            providerAccountId: payload.providerAccountId,
            status: payload.status,
          }),
        reason:
          error instanceof AppError ? error.message : "tenant_resolution_failed",
        metadata: {
          providerAccountId: payload.providerAccountId,
          status: payload.status,
        },
      });
      throw error;
    }

    const replayClaim = await WebhookReplayService.claimEvent({
      provider: WebhookProvider.WHATSAPP,
      eventType: "DELIVERY_STATUS",
      providerEventId: payload.externalMessageId,
      companyId,
      requestId: context?.requestId,
      signatureFingerprint: context?.signatureFingerprint ?? null,
      payloadFingerprintSource:
        context?.rawPayload ??
        JSON.stringify({
          externalMessageId: payload.externalMessageId,
          status: payload.status,
          timestamp: payload.timestamp,
          providerAccountId: payload.providerAccountId,
        }),
      reason: "status_ingestion",
      metadata: {
        providerAccountId: payload.providerAccountId,
      },
    });

    if (!replayClaim.accepted) {
      return;
    }

    const evidenceSource = evidenceSourceFromIds(payload.externalMessageId);

    if (evidenceSource === "SIMULATED") {
      await AuditLogService.record({
        companyId,
        action: "WHATSAPP_SIMULATED_STATUS_IGNORED",
        entityType: "MESSAGE",
        entityId: payload.externalMessageId,
        metadata: {
          status: payload.status,
          providerAccountId: payload.providerAccountId,
          evidenceSource,
        },
      });
      return;
    }

    // Find CRM message by provider message ID
    const message = await prisma.message.findFirst({
      where: {
        companyId,
        provider: ConversationChannel.WHATSAPP,
        externalMessageId: payload.externalMessageId,
      },
    });

    // Message may not exist yet
    if (!message) {
      ChannelObservabilityService.record({
        metric: "lifecycle.unmatched_status_events",
        provider: "WHATSAPP",
        companyId,
        requestId: context?.requestId,
        providerEventId: payload.externalMessageId,
        eventType: "WHATSAPP_DELIVERY_EVENT",
        outcome: "rejected",
        safeErrorCode: "DELIVERY_UNMATCHED",
      });

      await ChannelReliabilityService.moveToDlq({
        companyId,
        provider: ConversationChannel.WHATSAPP,
        reason: ChannelDlqReason.DELIVERY_UNMATCHED,
        sourceEventType: "WHATSAPP_DELIVERY_EVENT",
        payload: {
          externalMessageId: payload.externalMessageId,
          providerAccountId: payload.providerAccountId,
          status: payload.status,
          timestamp: payload.timestamp,
        },
        externalMessageId: payload.externalMessageId,
        providerAccountId: payload.providerAccountId,
        failureCode: "DELIVERY_UNMATCHED",
        failureReason: "delivery_event_without_message",
      });

      await AuditLogService.record({
        companyId,
        action: "WHATSAPP_DELIVERY_UNMATCHED",
        entityType: "MESSAGE",
        entityId: payload.externalMessageId,
        metadata: {
          externalMessageId: payload.externalMessageId,
          providerAccountId: payload.providerAccountId,
          status: payload.status,
        },
      });
      return;
    }

    if (
      messageStatusRank[payload.status] <
      messageStatusRank[message.status]
    ) {
      ChannelObservabilityService.record({
        metric: "lifecycle.invalid_transitions",
        provider: "WHATSAPP",
        companyId,
        requestId: context?.requestId,
        providerEventId: payload.externalMessageId,
        eventType: "WHATSAPP_DELIVERY_EVENT",
        outcome: "rejected",
        safeErrorCode: "INVALID_LIFECYCLE_TRANSITION",
      });

      await ChannelReliabilityService.moveToDlq({
        companyId,
        provider: ConversationChannel.WHATSAPP,
        reason: ChannelDlqReason.INVALID_LIFECYCLE_TRANSITION,
        sourceEventType: "WHATSAPP_DELIVERY_EVENT",
        payload: ChannelReliabilityService.toJsonValue({
          messageId: message.id,
          externalMessageId: payload.externalMessageId,
          fromStatus: message.status,
          toStatus: payload.status,
          providerAccountId: payload.providerAccountId,
          timestamp: payload.timestamp,
        }),
        messageId: message.id,
        externalMessageId: payload.externalMessageId,
        providerAccountId: payload.providerAccountId,
        failureCode: "INVALID_LIFECYCLE_TRANSITION",
        failureReason: "delivery_status_regression_detected",
      });

      return;
    }

    // Update CRM message status
    const updatedMessage = await prisma.message.update({
      where: {
        id: message.id,
      },

      data: {
        status: payload.status,
      },
    });

    await AuditLogService.record({
      companyId,
      action: "WHATSAPP_DELIVERY_STATUS_UPDATED",
      entityType: "MESSAGE",
      entityId: updatedMessage.id,
      metadata: {
        conversationId: updatedMessage.conversationId,
        externalMessageId: payload.externalMessageId,
        providerAccountId: payload.providerAccountId,
        from: message.status,
        to: payload.status,
      },
    });

    emitMessageStatusUpdated(updatedMessage);
    ChannelObservabilityService.record({
      metric: "lifecycle.status_updates",
      provider: "WHATSAPP",
      companyId,
      requestId: context?.requestId,
      providerEventId: payload.externalMessageId,
      eventType: "WHATSAPP_DELIVERY_EVENT",
      outcome: "success",
    });
  }

  // ===== Send outbound provider message =====
  static async sendOutboundMessage({ messageId, conversationId, content, metadata }: {
    messageId: string;
    conversationId: string;
    content: string;
    metadata?: Prisma.JsonValue | null;
  }) {
    // Find CRM conversation
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },

      include: {
        customer: true,
      },
    });

    // Conversation not found
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    // Determine provider channel
    switch (conversation.channel) {
      case ConversationChannel.WHATSAPP:
        return await this.sendWhatsAppMessage({
          companyId: conversation.companyId,
          messageId,
          conversationId,
          customerPhone: conversation.customer.phone || "",
          content,
          metadata,
        });

      case ConversationChannel.EMAIL:
        return await EmailService.sendOutboundMessage({
          companyId: conversation.companyId,
          messageId,
          conversationId,
          customerEmail: conversation.customer.email || "",
          subject: conversation.subject,
          content,
        });

      default:
        throw new Error("Unsupported provider channel");
    }
  }

  static async retryOutboundMessage(input: {
    companyId: string;
    messageId: string;
    force?: boolean;
  }) {
    const message = await prisma.message.findFirst({
      where: {
        id: input.messageId,
        companyId: input.companyId,
      },
      select: {
        id: true,
        companyId: true,
        conversationId: true,
        content: true,
        provider: true,
        status: true,
        metadata: true,
      },
    });

    if (!message) {
      throw new AppError("Message not found", HTTP_STATUS.NOT_FOUND);
    }

    if (
      message.provider !== ConversationChannel.WHATSAPP &&
      message.provider !== ConversationChannel.EMAIL
    ) {
      throw new AppError(
        "Message provider is not retryable",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    await ChannelReliabilityService.ensureRetryState({
      companyId: message.companyId,
      messageId: message.id,
      provider: message.provider,
    });

    const lockToken = await ChannelReliabilityService.acquireSendLock(
      message.id,
      input.force
    );

    if (!lockToken) {
      return null;
    }

    try {
      const result = await this.sendOutboundMessage({
        messageId: message.id,
        conversationId: message.conversationId,
        content: message.content,
        metadata: message.metadata,
      });

      await ChannelReliabilityService.markRetrySuccess(message.id, lockToken);
      return result;
    } catch (error) {
      const classification = ChannelReliabilityService.classifyOutboundFailure(
        message.provider,
        error
      );

      await ChannelReliabilityService.handleRetryFailure({
        companyId: message.companyId,
        messageId: message.id,
        provider: message.provider,
        classification,
        lockToken,
        sourceEventType: "OUTBOUND_SEND",
        payload: {
          messageId: message.id,
          conversationId: message.conversationId,
          content: message.content,
          provider: message.provider,
          metadata: message.metadata,
        },
        failureMeta: ChannelReliabilityService.toJsonValue(
          error instanceof AppError
            ? {
                code: error.code,
                details: error.details ?? null,
              }
            : {
                message: error instanceof Error ? error.message : "unknown_error",
              }
        ),
      });

      throw error;
    }
  }

  // ===== Send WhatsApp message =====
  static async sendWhatsAppMessage({
    companyId,
    messageId,
    conversationId,
    customerPhone,
    content,
    metadata,
  }: {
    companyId: string
    messageId: string;
    conversationId: string;
    customerPhone: string;
    content: string;
    metadata?: Prisma.JsonValue | null;
  }) {
    await ChannelReliabilityService.ensureRetryState({
      companyId,
      messageId,
      provider: ConversationChannel.WHATSAPP,
    });

    if (
      !env.WHATSAPP_PHONE_NUMBER_ID ||
      !env.WHATSAPP_ACCESS_TOKEN
    ) {
      const failedMessage = await prisma.message.update({
        where: {
          id: messageId,
        },
        data: {
          status: MessageStatus.FAILED,
          provider: ConversationChannel.WHATSAPP,
        },
      });

      emitMessageStatusUpdated(failedMessage);

      ChannelObservabilityService.record({
        metric: "messaging.send_failed",
        provider: "WHATSAPP",
        companyId,
        providerEventId: null,
        eventType: "WHATSAPP_SEND",
        outcome: "failure",
        safeErrorCode: "WHATSAPP_PROVIDER_NOT_CONFIGURED",
      });

      throw new AppError(
        "WhatsApp provider is not configured",
        HTTP_STATUS.BAD_GATEWAY,
        {
          code: "WHATSAPP_PROVIDER_NOT_CONFIGURED",
          details: {
            provider: "WHATSAPP",
          },
        }
      );
    }

    const normalizedRecipient = normalizeE164Phone(customerPhone);
    if (!normalizedRecipient) {
      const failedMessage = await prisma.message.update({
        where: { id: messageId },
        data: {
          status: MessageStatus.FAILED,
          provider: ConversationChannel.WHATSAPP,
        },
      });

      emitMessageStatusUpdated(failedMessage);

      throw new AppError(
        "WhatsApp recipient must be a valid E.164 number",
        HTTP_STATUS.BAD_REQUEST,
        {
          code: "WHATSAPP_INVALID_RECIPIENT",
          details: {
            provider: "WHATSAPP",
          },
        }
      );
    }

    const readiness = await this.getWhatsAppProviderReadiness(companyId);

    if (env.NODE_ENV !== "development" && !readiness.productionReady) {
      const failedMessage = await prisma.message.update({
        where: { id: messageId },
        data: {
          status: MessageStatus.FAILED,
          provider: ConversationChannel.WHATSAPP,
        },
      });

      emitMessageStatusUpdated(failedMessage);

      throw new AppError(
        "WhatsApp provider is not production-ready for real delivery",
        HTTP_STATUS.BAD_GATEWAY,
        {
          code: "WHATSAPP_PROVIDER_NOT_READY",
          details: {
            provider: "WHATSAPP",
            actionableErrors: readiness.actionableErrors,
            isTestNumber: readiness.isTestNumber,
          },
        }
      );
    }

    const template = parseWhatsAppTemplate(metadata ?? null);

    const latestInboundCustomerMessage = await prisma.message.findFirst({
      where: {
        companyId,
        conversationId,
        provider: ConversationChannel.WHATSAPP,
        sender: MessageSender.CUSTOMER,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true },
    });

    const customerWindowOpen = latestInboundCustomerMessage
      ? Date.now() - latestInboundCustomerMessage.createdAt.getTime() <=
        WHATSAPP_SERVICE_WINDOW_MS
      : false;

    if (!customerWindowOpen && !template) {
      const failedMessage = await prisma.message.update({
        where: { id: messageId },
        data: {
          status: MessageStatus.FAILED,
          provider: ConversationChannel.WHATSAPP,
        },
      });

      emitMessageStatusUpdated(failedMessage);

      throw new AppError(
        "WhatsApp free-form reply is outside the 24-hour customer service window. Send an approved template instead.",
        HTTP_STATUS.BAD_REQUEST,
        {
          code: "WHATSAPP_TEMPLATE_REQUIRED",
          details: {
            provider: "WHATSAPP",
            customerServiceWindowOpen: false,
          },
        }
      );
    }

    // Send outbound message through Meta WhatsApp Cloud API
    let externalMessageId: string;

    try {
      const response = await axios.post(
        `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: normalizedRecipient,
          ...(customerWindowOpen || !template
            ? {
                type: "text",
                text: {
                  body: content,
                },
              }
            : buildTemplatePayload(template)),
        },

        {
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      // Extract provider-generated WhatsApp message ID
      externalMessageId = response.data.messages?.[0]?.id;

      // Meta API returned unexpected response shape
      if (!externalMessageId) {
        throw new AppError(
          "WhatsApp provider did not return message ID",
          HTTP_STATUS.BAD_GATEWAY
        );
      }
    } catch (error) {
      // Normalize provider-specific API failures
      if (axios.isAxiosError(error)) {
        const failure = normalizeWhatsAppProviderFailure(error);

        const failedMessage = await prisma.message.update({
          where: {
            id: messageId,
          },
          data: {
            status: MessageStatus.FAILED,
            provider: ConversationChannel.WHATSAPP,
          },
        });

        emitMessageStatusUpdated(failedMessage);

        logWhatsAppProviderFailure(
          {
            companyId,
            conversationId,
            messageId,
          },
          failure
        );

        await AuditLogService.record({
          companyId,
          action: "WHATSAPP_MESSAGE_SEND_FAILED",
          entityType: "MESSAGE",
          entityId: failedMessage.id,
          metadata: {
            conversationId,
            reason: failure.reason,
            providerStatus: failure.providerStatus,
            providerCode: failure.providerCode,
            providerType: failure.providerType,
          },
        });

        ChannelObservabilityService.record({
          metric: "messaging.send_failed",
          provider: "WHATSAPP",
          companyId,
          providerEventId: null,
          eventType: "WHATSAPP_SEND",
          outcome: "failure",
          safeErrorCode: failure.reason === "PROVIDER_UNAVAILABLE"
            ? "WHATSAPP_PROVIDER_UNAVAILABLE"
            : "WHATSAPP_PROVIDER_REJECTED",
        });

        throw new AppError(
          WHATSAPP_SEND_FAILED_MESSAGE,
          HTTP_STATUS.BAD_GATEWAY,
          {
            code: "WHATSAPP_SEND_FAILED",
            details: failure,
          }
        );
      }

      throw error;
    }

    const message = await prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        status: MessageStatus.SENT,
        externalMessageId,
        provider: ConversationChannel.WHATSAPP,
        metadata:
          metadata && typeof metadata === "object"
            ? {
                ...(metadata as Record<string, unknown>),
                deliveryEvidenceSource: evidenceSourceFromIds(externalMessageId),
                deliveryAcceptedAt: new Date().toISOString(),
                deliveryAcceptanceMode:
                  customerWindowOpen || !template
                    ? "FREEFORM"
                    : "TEMPLATE",
              }
            : {
                deliveryEvidenceSource: evidenceSourceFromIds(externalMessageId),
                deliveryAcceptedAt: new Date().toISOString(),
                deliveryAcceptanceMode:
                  customerWindowOpen || !template
                    ? "FREEFORM"
                    : "TEMPLATE",
              },
      },
    });

    await AuditLogService.record({
      companyId,
      action: "WHATSAPP_MESSAGE_SENT",
      entityType: "MESSAGE",
      entityId: message.id,
      metadata: {
        conversationId,
        providerMessageId: externalMessageId,
        evidenceSource: evidenceSourceFromIds(externalMessageId),
        deliveryStatusSemantics: "ACCEPTED_BY_PROVIDER",
      },
    });

    // Emit realtime inbox update
    emitMessageStatusUpdated(message);

    ChannelObservabilityService.record({
      metric: "messaging.send_success",
      provider: "WHATSAPP",
      companyId,
      providerEventId: externalMessageId,
      eventType: "WHATSAPP_SEND",
      outcome: "success",
    });

    return message;
  }
}
