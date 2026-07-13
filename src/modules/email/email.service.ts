import {
  ChannelDlqReason,
  ConversationChannel,
  EmailAccountStatus,
  EmailProvider,
  MessageSender,
  MessageStatus,
  Prisma,
  UserRole,
  WebhookProvider,
} from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/config/db.js";
import { env } from "@/config/env.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import {
  Permissions,
  hasPermission,
} from "@/core/permissions/permission-policy.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { mapConversation } from "@/modules/conversations/conversation.mapper.js";
import { mapMessage } from "@/modules/messages/message.mapper.js";
import { getIO } from "@/socket/socket.server.js";
import { mapEmailAccount, mapEmailAccounts } from "./email.mapper.js";
import { WebhookReplayService } from "@/modules/channels/webhook-replay.service.js";
import { ChannelReliabilityService } from "@/modules/channels/channel-reliability.service.js";
import { ChannelObservabilityService } from "@/modules/channels/channel-observability.service.js";
import type {
  CreateEmailAccountInput,
  UpdateEmailAccountInput,
} from "./email.validation.js";

type UserContext = { userId: string; companyId: string; role: string };
type InboundEmail = {
  externalMessageId: string;
  providerEventId?: string;
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  subject: string;
  content: string;
  inReplyTo?: string;
  references?: string[];
  threadId?: string;
  headerMessageId?: string;
};

type EmailLifecycleStatus =
  | "DELIVERED"
  | "BOUNCED"
  | "COMPLAINED"
  | "DEFERRED"
  | "FAILED";

type EmailStatusEvent = {
  providerEventId?: string;
  externalMessageId: string;
  toEmail?: string;
  status: EmailLifecycleStatus;
  occurredAt?: string;
  failureReason?: string;
};

type ParsedEmailWebhookEvent =
  | { kind: "inbound"; payload: InboundEmail }
  | { kind: "status"; payload: EmailStatusEvent };

const emailMessageStatusRank: Record<MessageStatus, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const assertCanManage = (user: UserContext) => {
  if (!hasPermission(user.role as UserRole, Permissions.manageEmailChannels)) {
    throw new AppError("Email channel changes are not allowed", HTTP_STATUS.FORBIDDEN);
  }
};

const extractAddress = (value: unknown) => {
  if (typeof value !== "string") return null;
  const address = normalizeEmail(value.match(/<([^>]+)>/)?.[1] ?? value);
  return address.includes("@") ? address : null;
};

const extractName = (value: unknown) => {
  if (typeof value !== "string" || !value.includes("<")) return undefined;
  return value.slice(0, value.indexOf("<")).trim().replace(/^"|"$/g, "") || undefined;
};

const normalizeHeaderMessageId = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^<|>$/g, "").trim() || null;
};

const extractHeaderValue = (headers: unknown, key: string) => {
  if (!headers) return null;

  const normalizedKey = key.toLowerCase();

  if (Array.isArray(headers)) {
    for (const item of headers) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const itemKey = String(entry.name ?? entry.key ?? "").toLowerCase();
      if (itemKey === normalizedKey) {
        return normalizeHeaderMessageId(entry.value);
      }
    }

    return null;
  }

  if (typeof headers === "object") {
    const map = headers as Record<string, unknown>;
    const direct = Object.keys(map).find(
      (candidate) => candidate.toLowerCase() === normalizedKey
    );

    if (direct) {
      return normalizeHeaderMessageId(map[direct]);
    }
  }

  return null;
};

const extractReferences = (headers: unknown) => {
  const value = extractHeaderValue(headers, "references");
  if (!value) return [];

  return value
    .split(/\s+/)
    .map((part) => normalizeHeaderMessageId(part))
    .filter((part): part is string => Boolean(part));
};

const mapLifecycleToMessageStatus = (status: EmailLifecycleStatus): MessageStatus => {
  switch (status) {
    case "DELIVERED":
      return MessageStatus.DELIVERED;
    case "DEFERRED":
      return MessageStatus.PENDING;
    case "BOUNCED":
    case "COMPLAINED":
    case "FAILED":
      return MessageStatus.FAILED;
  }
};

const parseInboundEmail = (payload: unknown): InboundEmail => {
  const root = payload as Record<string, unknown>;
  const allowDevelopmentPayload =
    (env.NODE_ENV === "development" &&
      env.ALLOW_UNSIGNED_WEBHOOKS_IN_DEVELOPMENT) ||
    env.ALLOW_UNSIGNED_WEBHOOKS_IN_DEVELOPMENT;

  if (
    allowDevelopmentPayload &&
    root?.type === "omnicore.email.test" &&
    typeof root.fromEmail === "string" &&
    typeof root.toEmail === "string" &&
    typeof root.content === "string"
  ) {
    const fromEmail = extractAddress(root.fromEmail);
    const toEmail = extractAddress(root.toEmail);
    const content = root.content.trim();
    if (!fromEmail || !toEmail || !content) {
      throw new AppError("Unsupported email webhook payload", HTTP_STATUS.BAD_REQUEST);
    }

    return {
      externalMessageId:
        typeof root.externalMessageId === "string" && root.externalMessageId.trim()
          ? root.externalMessageId.trim()
          : `dev-email-${Date.now()}`,
      providerEventId:
        typeof root.eventId === "string" && root.eventId.trim()
          ? root.eventId.trim()
          : undefined,
      fromEmail,
      fromName: typeof root.fromName === "string" ? root.fromName.trim() : undefined,
      toEmail,
      subject:
        typeof root.subject === "string" && root.subject.trim()
          ? root.subject.trim().slice(0, 500)
          : "Local email test",
      content: content.slice(0, 5000),
      inReplyTo:
        typeof root.inReplyTo === "string"
          ? normalizeHeaderMessageId(root.inReplyTo) ?? undefined
          : undefined,
      references: Array.isArray(root.references)
        ? root.references
            .map((entry) => normalizeHeaderMessageId(entry))
            .filter((entry): entry is string => Boolean(entry))
        : undefined,
      threadId:
        typeof root.threadId === "string" && root.threadId.trim()
          ? root.threadId.trim()
          : undefined,
      headerMessageId:
        typeof root.headerMessageId === "string"
          ? normalizeHeaderMessageId(root.headerMessageId) ?? undefined
          : undefined,
    };
  }

  const data =
    root && typeof root.data === "object" && root.data
      ? (root.data as Record<string, unknown>)
      : root;
  const fromEmail = extractAddress(data?.from);
  const toEmail = extractAddress(Array.isArray(data?.to) ? data.to[0] : data?.to);
  const externalMessageId =
    typeof data?.email_id === "string"
      ? data.email_id
      : typeof data?.id === "string"
        ? data.id
        : null;
  const content =
    typeof data?.text === "string"
      ? data.text.trim()
      : typeof data?.content === "string"
        ? data.content.trim()
        : "";
  const subject =
    typeof data?.subject === "string" && data.subject.trim()
      ? data.subject.trim().slice(0, 500)
      : "Email support request";
  const headers = data?.headers;
  const inReplyTo =
    extractHeaderValue(headers, "in-reply-to") ||
    normalizeHeaderMessageId(data?.in_reply_to) ||
    normalizeHeaderMessageId(data?.inReplyTo);
  const references = [
    ...extractReferences(headers),
    ...(Array.isArray(data?.references)
      ? data.references
          .map((item) => normalizeHeaderMessageId(item))
          .filter((item): item is string => Boolean(item))
      : []),
  ];
  const threadId =
    typeof data?.thread_id === "string" && data.thread_id.trim()
      ? data.thread_id.trim()
      : typeof data?.threadId === "string" && data.threadId.trim()
        ? data.threadId.trim()
        : undefined;
  const headerMessageId =
    extractHeaderValue(headers, "message-id") ||
    normalizeHeaderMessageId(data?.message_id) ||
    normalizeHeaderMessageId(data?.messageId);
  const providerEventId =
    typeof root?.id === "string"
      ? root.id
      : typeof data?.event_id === "string"
        ? data.event_id
        : typeof data?.eventId === "string"
          ? data.eventId
          : undefined;

  if (!fromEmail || !toEmail || !externalMessageId || !content) {
    throw new AppError("Unsupported email webhook payload", HTTP_STATUS.BAD_REQUEST);
  }

  return {
    externalMessageId,
    providerEventId,
    fromEmail,
    fromName: extractName(data?.from),
    toEmail,
    subject,
    content: content.slice(0, 5000),
    inReplyTo: inReplyTo ?? undefined,
    references,
    threadId,
    headerMessageId: headerMessageId ?? undefined,
  };
};

const parseEmailStatusEvent = (payload: unknown): EmailStatusEvent | null => {
  const root = payload as Record<string, unknown>;
  const data =
    root && typeof root.data === "object" && root.data
      ? (root.data as Record<string, unknown>)
      : root;

  const rawType = String(root?.type ?? data?.type ?? "").toLowerCase();
  const normalized = rawType
    .replace(/^email\./, "")
    .replace(/^resend\.email\./, "")
    .replace(/^event\./, "")
    .trim();

  const map: Record<string, EmailLifecycleStatus> = {
    delivered: "DELIVERED",
    bounced: "BOUNCED",
    complained: "COMPLAINED",
    complaint: "COMPLAINED",
    deferred: "DEFERRED",
    failed: "FAILED",
  };

  const lifecycle =
    map[normalized] ||
    map[String(data?.status ?? "").toLowerCase()] ||
    map[String(data?.event ?? "").toLowerCase()];

  if (!lifecycle) {
    return null;
  }

  const externalMessageId =
    typeof data?.email_id === "string"
      ? data.email_id
      : typeof data?.id === "string"
        ? data.id
        : typeof data?.message_id === "string"
          ? data.message_id
          : null;

  if (!externalMessageId) {
    throw new AppError("Unsupported email status payload", HTTP_STATUS.BAD_REQUEST);
  }

  const toEmail = extractAddress(Array.isArray(data?.to) ? data.to[0] : data?.to);

  return {
    providerEventId:
      typeof root?.id === "string"
        ? root.id
        : typeof data?.event_id === "string"
          ? data.event_id
          : undefined,
    externalMessageId,
    toEmail: toEmail ?? undefined,
    status: lifecycle,
    occurredAt:
      typeof data?.created_at === "string"
        ? data.created_at
        : typeof data?.timestamp === "string"
          ? data.timestamp
          : undefined,
    failureReason:
      typeof data?.reason === "string"
        ? data.reason
        : typeof data?.failure_reason === "string"
          ? data.failure_reason
          : undefined,
  };
};

const parseEmailWebhookEvent = (payload: unknown): ParsedEmailWebhookEvent => {
  const status = parseEmailStatusEvent(payload);
  if (status) {
    return {
      kind: "status",
      payload: status,
    };
  }

  return {
    kind: "inbound",
    payload: parseInboundEmail(payload),
  };
};

const emitMessageStatus = (
  message: Awaited<ReturnType<typeof prisma.message.update>>
) => {
  getIO()
    .to(`conversation:${message.conversationId}`)
    .emit("message_status_updated", mapMessage(message));
};

export class EmailService {
  static verifyWebhookSignature(input: {
    receivedSecret?: string;
    svixId?: string;
    svixTimestamp?: string;
    svixSignature?: string;
    rawBody?: Buffer;
  }) {
    if (!env.EMAIL_WEBHOOK_SECRET) {
      if (
        env.NODE_ENV === "development" &&
        env.ALLOW_UNSIGNED_WEBHOOKS_IN_DEVELOPMENT
      ) {
        return;
      }
      throw new AppError("Email webhook is not configured", HTTP_STATUS.FORBIDDEN);
    }

    if (
      input.svixId &&
      input.svixTimestamp &&
      input.svixSignature &&
      input.rawBody
    ) {
      const timestamp = Number(input.svixTimestamp);
      if (
        !Number.isFinite(timestamp) ||
        Math.abs(Date.now() / 1000 - timestamp) > 300
      ) {
        throw new AppError("Expired email webhook signature", HTTP_STATUS.FORBIDDEN);
      }
      const secret = env.EMAIL_WEBHOOK_SECRET.startsWith("whsec_")
        ? Buffer.from(env.EMAIL_WEBHOOK_SECRET.slice(6), "base64")
        : Buffer.from(env.EMAIL_WEBHOOK_SECRET);
      const expected = createHmac("sha256", secret)
        .update(`${input.svixId}.${input.svixTimestamp}.${input.rawBody.toString("utf8")}`)
        .digest("base64");
      const valid = input.svixSignature
        .split(/\s+/)
        .map((signature) => signature.split(",")[1])
        .filter(Boolean)
        .some((signature) => {
          const left = Buffer.from(signature);
          const right = Buffer.from(expected);
          return left.length === right.length && timingSafeEqual(left, right);
        });
      if (valid) return;
      throw new AppError("Invalid email webhook signature", HTTP_STATUS.FORBIDDEN);
    }

    const left = Buffer.from(input.receivedSecret ?? "");
    const right = Buffer.from(env.EMAIL_WEBHOOK_SECRET);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new AppError("Invalid email webhook signature", HTTP_STATUS.FORBIDDEN);
    }
  }

  static async listAccounts(companyId: string) {
    return mapEmailAccounts(
      await prisma.emailAccount.findMany({
        where: { companyId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      })
    );
  }

  static async createAccount(user: UserContext, input: CreateEmailAccountInput) {
    assertCanManage(user);
    const account = await prisma.emailAccount.create({
      data: {
        companyId: user.companyId,
        provider: input.provider,
        fromEmail: normalizeEmail(input.fromEmail),
        fromName: input.fromName,
        status: input.status,
      },
    });
    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "EMAIL_ACCOUNT_CREATED",
      entityType: "EMAIL_ACCOUNT",
      entityId: account.id,
      metadata: { provider: account.provider, fromEmail: account.fromEmail },
    });
    return mapEmailAccount(account);
  }

  static async updateAccount(
    user: UserContext,
    accountId: string,
    input: UpdateEmailAccountInput
  ) {
    assertCanManage(user);
    const existing = await prisma.emailAccount.findFirst({
      where: { id: accountId, companyId: user.companyId },
    });
    if (!existing) throw new AppError("Email account not found", HTTP_STATUS.NOT_FOUND);
    const account = await prisma.emailAccount.update({
      where: { id: accountId },
      data: {
        ...input,
        ...(input.fromEmail ? { fromEmail: normalizeEmail(input.fromEmail) } : {}),
      },
    });
    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "EMAIL_ACCOUNT_UPDATED",
      entityType: "EMAIL_ACCOUNT",
      entityId: account.id,
      metadata: {
        provider: account.provider,
        fromEmail: account.fromEmail,
        status: account.status,
      },
    });
    return mapEmailAccount(account);
  }

  static async deleteAccount(user: UserContext, accountId: string) {
    assertCanManage(user);
    const existing = await prisma.emailAccount.findFirst({
      where: { id: accountId, companyId: user.companyId },
    });
    if (!existing) throw new AppError("Email account not found", HTTP_STATUS.NOT_FOUND);
    await prisma.emailAccount.delete({ where: { id: accountId } });
    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "EMAIL_ACCOUNT_DELETED",
      entityType: "EMAIL_ACCOUNT",
      entityId: existing.id,
      metadata: { provider: existing.provider, fromEmail: existing.fromEmail },
    });
    return mapEmailAccount(existing);
  }

  static async processWebhook(payload: unknown) {
    const parsed = parseEmailWebhookEvent(payload);
    const payloadText = JSON.stringify(payload);
    const payloadFingerprint = WebhookReplayService.payloadFingerprint(payloadText);

    if (parsed.kind === "status") {
      return this.processStatusWebhook(parsed.payload, payloadText, payloadFingerprint);
    }

    const email = parsed.payload;

    const account = await prisma.emailAccount.findFirst({
      where: {
        provider: EmailProvider.RESEND,
        fromEmail: email.toEmail,
        status: EmailAccountStatus.ACTIVE,
      },
    });

    if (!account) {
      ChannelObservabilityService.record({
        metric: "webhook.rejected",
        provider: "EMAIL",
        companyId: null,
        providerEventId: email.providerEventId ?? email.externalMessageId,
        eventType: "EMAIL_WEBHOOK",
        outcome: "rejected",
        safeErrorCode: "INVALID_TENANT_RESOLUTION",
      });

      await WebhookReplayService.recordSecurityEvent({
        provider: WebhookProvider.EMAIL,
        eventType: "SECURITY_INVALID_TENANT_RESOLUTION",
        providerEventId: email.externalMessageId || payloadFingerprint,
        payloadFingerprintSource: payloadText,
        reason: "active_email_account_not_found",
        metadata: {
          toEmail: email.toEmail,
          fromEmail: email.fromEmail,
        },
      });
      throw new AppError("Email channel not found", HTTP_STATUS.NOT_FOUND);
    }

    const replayClaim = await WebhookReplayService.claimEvent({
      provider: WebhookProvider.EMAIL,
      eventType: "MESSAGE_RECEIVED",
      providerEventId: email.providerEventId ?? email.externalMessageId,
      companyId: account.companyId,
      payloadFingerprintSource: payloadText,
      reason: "email_webhook_ingestion",
      metadata: {
        toEmail: email.toEmail,
      },
    });

    if (!replayClaim.accepted) {
      return null;
    }

    const duplicate = await prisma.message.findFirst({
      where: {
        companyId: account.companyId,
        provider: ConversationChannel.EMAIL,
        externalMessageId: email.externalMessageId,
      },
    });
    if (duplicate) {
      await AuditLogService.record({
        companyId: account.companyId,
        action: "EMAIL_REPLAY_REJECTED",
        entityType: "WEBHOOK_EVENT",
        entityId: email.externalMessageId,
        metadata: {
          reason: "message_external_id_already_processed",
          toEmail: email.toEmail,
        },
      });
      return mapMessage(duplicate);
    }

    let isNewConversation = false;
    const result = await prisma.$transaction(async (tx) => {
      let customer = await tx.customer.findFirst({
        where: { companyId: account.companyId, email: email.fromEmail },
      });
      if (!customer) {
        const parts = (email.fromName ?? email.fromEmail.split("@")[0]).split(/\s+/);
        customer = await tx.customer.create({
          data: {
            companyId: account.companyId,
            firstName: parts[0] || "Email",
            lastName: parts.slice(1).join(" ") || "Customer",
            email: email.fromEmail,
          },
        });
      }

      let conversation = await tx.conversation.findFirst({
        where: {
          companyId: account.companyId,
          customerId: customer.id,
          channel: ConversationChannel.EMAIL,
        },
      });

      const threadCandidates = [
        email.inReplyTo,
        ...(email.references ?? []),
      ].filter((candidate): candidate is string => Boolean(candidate));

      if (threadCandidates.length > 0) {
        const threadedMessage = await tx.message.findFirst({
          where: {
            companyId: account.companyId,
            provider: ConversationChannel.EMAIL,
            externalMessageId: {
              in: threadCandidates,
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            conversationId: true,
          },
        });

        if (threadedMessage) {
          conversation =
            (await tx.conversation.findFirst({
              where: {
                id: threadedMessage.conversationId,
                companyId: account.companyId,
              },
            })) ?? conversation;
        }
      }

      if (!conversation) {
        conversation = await tx.conversation.create({
          data: {
            companyId: account.companyId,
            customerId: customer.id,
            channel: ConversationChannel.EMAIL,
            subject: email.subject,
          },
        });
        isNewConversation = true;
      } else {
        conversation = await tx.conversation.update({
          where: { id: conversation.id },
          data: { subject: email.subject, updatedAt: new Date() },
        });
      }

      const message = await tx.message.create({
        data: {
          companyId: account.companyId,
          conversationId: conversation.id,
          sender: MessageSender.CUSTOMER,
          content: email.content,
          status: MessageStatus.DELIVERED,
          provider: ConversationChannel.EMAIL,
          externalMessageId: email.externalMessageId,
          metadata: {
            subject: email.subject,
            from: email.fromEmail,
            to: [email.toEmail],
            inReplyTo: email.inReplyTo ?? null,
            references: email.references ?? [],
            threadId: email.threadId ?? null,
            headerMessageId: email.headerMessageId ?? null,
          },
        },
      });
      return { customer, conversation, message };
    }).catch(async (error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const duplicate = await prisma.message.findFirst({
          where: {
            companyId: account.companyId,
            provider: ConversationChannel.EMAIL,
            externalMessageId: email.externalMessageId,
          },
        });

        return duplicate
          ? { customer: null, conversation: null, message: duplicate }
          : null;
      }

      await ChannelReliabilityService.moveToDlq({
        companyId: account.companyId,
        provider: ConversationChannel.EMAIL,
        reason: ChannelDlqReason.PROVIDER_PROCESSING_FAILURE,
        sourceEventType: "EMAIL_WEBHOOK_INGESTION",
        payload: ChannelReliabilityService.toJsonValue(payload),
        externalMessageId: email.externalMessageId,
        failureCode: "EMAIL_WEBHOOK_PROCESSING_FAILED",
        failureReason: error instanceof Error ? error.message : "email_webhook_processing_failed",
      });

      throw error;
    });
    if (!result) return null;
    if (!result.customer || !result.conversation) return mapMessage(result.message);

    const io = getIO();
    io.to(`conversation:${result.conversation.id}`).emit("new_message", mapMessage(result.message));
    if (isNewConversation) {
      io.to(`company:${account.companyId}`).emit(
        "new_conversation",
        mapConversation({
          ...result.conversation,
          customer: result.customer,
          messages: [result.message],
        })
      );
    }
    await AuditLogService.record({
      companyId: account.companyId,
      action: "EMAIL_RECEIVED",
      entityType: "MESSAGE",
      entityId: result.message.id,
      metadata: {
        conversationId: result.conversation.id,
        from: email.fromEmail,
        to: email.toEmail,
        subject: email.subject,
      },
    });

    ChannelObservabilityService.record({
      metric: "webhook.accepted",
      provider: "EMAIL",
      companyId: account.companyId,
      providerEventId: email.providerEventId ?? email.externalMessageId,
      eventType: "EMAIL_INBOUND_MESSAGE",
      outcome: "accepted",
    });
    return mapMessage(result.message);
  }

  static async processStatusWebhook(
    event: EmailStatusEvent,
    payloadText: string,
    payloadFingerprint: string
  ) {
    const message = await prisma.message.findFirst({
      where: {
        provider: ConversationChannel.EMAIL,
        externalMessageId: event.externalMessageId,
      },
      select: {
        id: true,
        companyId: true,
        status: true,
        conversationId: true,
      },
    });

    if (!message) {
      ChannelObservabilityService.record({
        metric: "lifecycle.unmatched_status_events",
        provider: "EMAIL",
        companyId: null,
        providerEventId: event.providerEventId ?? event.externalMessageId,
        eventType: "EMAIL_STATUS_EVENT",
        outcome: "rejected",
        safeErrorCode: "EMAIL_STATUS_UNMATCHED",
      });

      await ChannelReliabilityService.moveToDlq({
        provider: ConversationChannel.EMAIL,
        reason: ChannelDlqReason.DELIVERY_UNMATCHED,
        sourceEventType: "EMAIL_STATUS_EVENT",
        payload: ChannelReliabilityService.toJsonValue({
          externalMessageId: event.externalMessageId,
          providerEventId: event.providerEventId,
          status: event.status,
          occurredAt: event.occurredAt,
          toEmail: event.toEmail,
          failureReason: event.failureReason,
        }),
        externalMessageId: event.externalMessageId,
        failureCode: "EMAIL_STATUS_UNMATCHED",
        failureReason: "email_status_without_message",
      });

      await WebhookReplayService.recordSecurityEvent({
        provider: WebhookProvider.EMAIL,
        eventType: "SECURITY_INVALID_TENANT_RESOLUTION",
        providerEventId: event.providerEventId ?? event.externalMessageId,
        payloadFingerprintSource: payloadText,
        reason: "email_status_without_message",
        metadata: {
          status: event.status,
          toEmail: event.toEmail,
        },
      });

      return null;
    }

    const replayClaim = await WebhookReplayService.claimEvent({
      provider: WebhookProvider.EMAIL,
      eventType: `STATUS_${event.status}`,
      providerEventId:
        event.providerEventId ||
        `${event.externalMessageId}:${event.status}:${event.occurredAt ?? "unknown"}`,
      companyId: message.companyId,
      payloadFingerprintSource: payloadText,
      reason: "email_status_ingestion",
      metadata: {
        externalMessageId: event.externalMessageId,
        status: event.status,
      },
    });

    if (!replayClaim.accepted) {
      return null;
    }

    const nextStatus = mapLifecycleToMessageStatus(event.status);

    if (emailMessageStatusRank[nextStatus] < emailMessageStatusRank[message.status]) {
      ChannelObservabilityService.record({
        metric: "lifecycle.invalid_transitions",
        provider: "EMAIL",
        companyId: message.companyId,
        providerEventId: event.providerEventId ?? event.externalMessageId,
        eventType: "EMAIL_STATUS_EVENT",
        outcome: "rejected",
        safeErrorCode: "EMAIL_STATUS_REGRESSION",
      });

      await ChannelReliabilityService.moveToDlq({
        companyId: message.companyId,
        provider: ConversationChannel.EMAIL,
        reason: ChannelDlqReason.INVALID_LIFECYCLE_TRANSITION,
        sourceEventType: "EMAIL_STATUS_EVENT",
        payload: ChannelReliabilityService.toJsonValue({
          messageId: message.id,
          externalMessageId: event.externalMessageId,
          fromStatus: message.status,
          toStatus: nextStatus,
          providerStatus: event.status,
          providerEventId: event.providerEventId,
        }),
        messageId: message.id,
        externalMessageId: event.externalMessageId,
        failureCode: "EMAIL_STATUS_REGRESSION",
        failureReason: "email_status_regression_detected",
      });

      await AuditLogService.record({
        companyId: message.companyId,
        action: "EMAIL_STATUS_INVALID_TRANSITION",
        entityType: "MESSAGE",
        entityId: message.id,
        metadata: {
          from: message.status,
          to: nextStatus,
          providerStatus: event.status,
          externalMessageId: event.externalMessageId,
        },
      });

      return null;
    }

    const updated = await prisma.message.update({
      where: {
        id: message.id,
      },
      data: {
        status: nextStatus,
      },
    });

    await AuditLogService.record({
      companyId: message.companyId,
      action: "EMAIL_STATUS_UPDATED",
      entityType: "MESSAGE",
      entityId: updated.id,
      metadata: {
        conversationId: updated.conversationId,
        externalMessageId: event.externalMessageId,
        providerEventId: event.providerEventId,
        from: message.status,
        to: nextStatus,
        providerStatus: event.status,
      },
    });

    ChannelObservabilityService.record({
      metric: "lifecycle.status_updates",
      provider: "EMAIL",
      companyId: message.companyId,
      providerEventId: event.providerEventId ?? event.externalMessageId,
      eventType: "EMAIL_STATUS_EVENT",
      outcome: "success",
    });

    if (event.status === "DELIVERED") {
      ChannelObservabilityService.record({
        metric: "deliverability.delivered",
        provider: "EMAIL",
        companyId: message.companyId,
        providerEventId: event.providerEventId ?? event.externalMessageId,
        eventType: "EMAIL_STATUS_EVENT",
        outcome: "success",
      });
    }

    if (event.status === "BOUNCED") {
      ChannelObservabilityService.record({
        metric: "deliverability.bounced",
        provider: "EMAIL",
        companyId: message.companyId,
        providerEventId: event.providerEventId ?? event.externalMessageId,
        eventType: "EMAIL_STATUS_EVENT",
        outcome: "success",
      });
    }

    if (event.status === "COMPLAINED") {
      ChannelObservabilityService.record({
        metric: "deliverability.complained",
        provider: "EMAIL",
        companyId: message.companyId,
        providerEventId: event.providerEventId ?? event.externalMessageId,
        eventType: "EMAIL_STATUS_EVENT",
        outcome: "success",
      });
    }

    if (event.status === "DEFERRED") {
      ChannelObservabilityService.record({
        metric: "deliverability.deferred",
        provider: "EMAIL",
        companyId: message.companyId,
        providerEventId: event.providerEventId ?? event.externalMessageId,
        eventType: "EMAIL_STATUS_EVENT",
        outcome: "success",
      });
    }

    emitMessageStatus(updated);
    return mapMessage(updated);
  }

  static async sendOutboundMessage(input: {
    companyId: string;
    messageId: string;
    conversationId: string;
    customerEmail: string;
    subject?: string | null;
    content: string;
  }) {
    await ChannelReliabilityService.ensureRetryState({
      companyId: input.companyId,
      messageId: input.messageId,
      provider: ConversationChannel.EMAIL,
    });

    const fail = async (
      message: string,
      code: string,
      details?: Record<string, unknown>
    ): Promise<never> => {
      const failed = await prisma.message.update({
        where: { id: input.messageId },
        data: { status: MessageStatus.FAILED, provider: ConversationChannel.EMAIL },
      });
      emitMessageStatus(failed);
      throw new AppError(message, HTTP_STATUS.BAD_GATEWAY, {
        code,
        details: {
          provider: "EMAIL",
          ...details,
        },
      });
    };
    const account = await prisma.emailAccount.findFirst({
      where: { companyId: input.companyId, status: EmailAccountStatus.ACTIVE },
      orderBy: { createdAt: "asc" },
    });
    if (!account || !env.RESEND_API_KEY || !input.customerEmail) {
      ChannelObservabilityService.record({
        metric: "messaging.send_failed",
        provider: "EMAIL",
        companyId: input.companyId,
        providerEventId: null,
        eventType: "EMAIL_SEND",
        outcome: "failure",
        safeErrorCode: "EMAIL_PROVIDER_NOT_CONFIGURED",
      });

      return fail(
        "Email message failed. The email channel or recipient is not configured.",
        "EMAIL_PROVIDER_NOT_CONFIGURED",
        {
          reason: "provider_not_configured",
        }
      );
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: account.fromName
            ? `${account.fromName} <${account.fromEmail}>`
            : account.fromEmail,
          to: [input.customerEmail],
          subject: input.subject || "Re: Support request",
          text: input.content,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      if (!response.ok || !body.id) {
        console.error(JSON.stringify({
          level: "error",
          event: "email_provider_send_failed",
          companyId: input.companyId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          providerStatus: response.status,
        }));
        return fail(
          "Email message failed. Check the recipient and email channel configuration.",
          "EMAIL_SEND_FAILED",
          {
            reason: "provider_rejected",
            providerStatus: response.status,
          }
        );
      }

      const sent = await prisma.message.update({
        where: { id: input.messageId },
        data: {
          status: MessageStatus.SENT,
          provider: ConversationChannel.EMAIL,
          externalMessageId: body.id,
          metadata: {
            subject: input.subject || "Re: Support request",
            from: account.fromEmail,
            to: [input.customerEmail],
          },
        },
      });
      emitMessageStatus(sent);
      await AuditLogService.record({
        companyId: input.companyId,
        action: "EMAIL_SENT",
        entityType: "MESSAGE",
        entityId: sent.id,
        metadata: {
          conversationId: input.conversationId,
          from: account.fromEmail,
          to: input.customerEmail,
          subject: input.subject || "Re: Support request",
        },
      });
      ChannelObservabilityService.record({
        metric: "messaging.send_success",
        provider: "EMAIL",
        companyId: input.companyId,
        providerEventId: body.id,
        eventType: "EMAIL_SEND",
        outcome: "success",
      });
      return sent;
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error(JSON.stringify({
        level: "error",
        event: "email_provider_unavailable",
        companyId: input.companyId,
        conversationId: input.conversationId,
        messageId: input.messageId,
      }));
      ChannelObservabilityService.record({
        metric: "messaging.send_failed",
        provider: "EMAIL",
        companyId: input.companyId,
        providerEventId: null,
        eventType: "EMAIL_SEND",
        outcome: "failure",
        safeErrorCode: "EMAIL_PROVIDER_UNAVAILABLE",
      });
      return fail(
        "Email message failed because the email provider is unavailable.",
        "EMAIL_PROVIDER_UNAVAILABLE",
        {
          reason: "provider_unavailable",
        }
      );
    }
  }
}
