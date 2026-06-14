import {
  ConversationChannel,
  EmailAccountStatus,
  EmailProvider,
  MessageSender,
  MessageStatus,
  Prisma,
} from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/config/db.js";
import { env } from "@/config/env.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { mapConversation } from "@/modules/conversations/conversation.mapper.js";
import { mapMessage } from "@/modules/messages/message.mapper.js";
import { getIO } from "@/socket/socket.server.js";
import { mapEmailAccount, mapEmailAccounts } from "./email.mapper.js";
import type {
  CreateEmailAccountInput,
  UpdateEmailAccountInput,
} from "./email.validation.js";

type UserContext = { userId: string; companyId: string; role: string };
type InboundEmail = {
  externalMessageId: string;
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  subject: string;
  content: string;
};

const managementRoles = new Set(["OWNER", "ADMIN", "TEAM_LEAD"]);
const normalizeEmail = (value: string) => value.trim().toLowerCase();

const assertCanManage = (user: UserContext) => {
  if (!managementRoles.has(user.role)) {
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

const parseInboundEmail = (payload: unknown): InboundEmail => {
  const root = payload as Record<string, unknown>;
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

  if (!fromEmail || !toEmail || !externalMessageId || !content) {
    throw new AppError("Unsupported email webhook payload", HTTP_STATUS.BAD_REQUEST);
  }
  return {
    externalMessageId,
    fromEmail,
    fromName: extractName(data?.from),
    toEmail,
    subject,
    content: content.slice(0, 5000),
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
      if (env.NODE_ENV === "development") return;
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
    const email = parseInboundEmail(payload);
    const account = await prisma.emailAccount.findFirst({
      where: {
        provider: EmailProvider.RESEND,
        fromEmail: email.toEmail,
        status: EmailAccountStatus.ACTIVE,
      },
    });
    if (!account) throw new AppError("Email channel not found", HTTP_STATUS.NOT_FOUND);

    const duplicate = await prisma.message.findFirst({
      where: {
        companyId: account.companyId,
        provider: ConversationChannel.EMAIL,
        externalMessageId: email.externalMessageId,
      },
    });
    if (duplicate) return mapMessage(duplicate);

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
          },
        },
      });
      return { customer, conversation, message };
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return null;
      }
      throw error;
    });
    if (!result) return null;

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
    return mapMessage(result.message);
  }

  static async sendOutboundMessage(input: {
    companyId: string;
    messageId: string;
    conversationId: string;
    customerEmail: string;
    subject?: string | null;
    content: string;
  }) {
    const fail = async (message: string, code: string): Promise<never> => {
      const failed = await prisma.message.update({
        where: { id: input.messageId },
        data: { status: MessageStatus.FAILED, provider: ConversationChannel.EMAIL },
      });
      emitMessageStatus(failed);
      throw new AppError(message, HTTP_STATUS.BAD_GATEWAY, {
        code,
        details: { provider: "EMAIL" },
      });
    };
    const account = await prisma.emailAccount.findFirst({
      where: { companyId: input.companyId, status: EmailAccountStatus.ACTIVE },
      orderBy: { createdAt: "asc" },
    });
    if (!account || !env.RESEND_API_KEY || !input.customerEmail) {
      return fail(
        "Email message failed. The email channel or recipient is not configured.",
        "EMAIL_PROVIDER_NOT_CONFIGURED"
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
          "EMAIL_SEND_FAILED"
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
      return fail(
        "Email message failed because the email provider is unavailable.",
        "EMAIL_PROVIDER_UNAVAILABLE"
      );
    }
  }
}
