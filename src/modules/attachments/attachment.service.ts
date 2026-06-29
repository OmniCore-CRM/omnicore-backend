import {
  AttachmentUploadedFrom,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { getIO } from "@/socket/socket.server.js";
import { mapAttachment } from "./attachment.mapper.js";
import { attachmentStorage } from "./attachment.storage.js";
import { WidgetService } from "@/modules/widget/widget.service.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";

type AgentContext = {
  userId: string;
  companyId: string;
  role: string;
};

type TargetInput = {
  conversationId?: string;
  messageId?: string;
  ticketId?: string;
};

const safeUploaderSelect = {
  id: true,
  firstName: true,
  lastName: true,
} satisfies Prisma.UserSelect;

const attachmentInclude = {
  uploadedBy: { select: safeUploaderSelect },
} satisfies Prisma.AttachmentInclude;

const notFound = () =>
  new AppError("Attachment not found", HTTP_STATUS.NOT_FOUND);

export class AttachmentService {
  static async uploadAgentAttachment(
    user: AgentContext,
    file: Express.Multer.File,
    target: TargetInput
  ) {
    if (user.role === "VIEWER") {
      throw new AppError(
        "Attachment uploads are not allowed for viewer users",
        HTTP_STATUS.FORBIDDEN
      );
    }

    const links = await this.resolveAgentTarget(user.companyId, target);
    return this.persist(file, {
      ...links,
      companyId: user.companyId,
      uploadedById: user.userId,
      uploadedFrom: AttachmentUploadedFrom.AGENT,
    });
  }

  static async uploadWidgetAttachment(
    file: Express.Multer.File,
    input: {
      publicKey: string;
      sessionToken: string;
      conversationId: string;
      requestOrigin?: string;
    }
  ) {
    const session = await WidgetService.authorizeConversationSession(
      input.publicKey,
      input.sessionToken,
      input.conversationId,
      input.requestOrigin
    );

    return this.persist(file, {
      companyId: session.companyId,
      customerId: session.customerId,
      conversationId: session.conversationId,
      uploadedFrom: AttachmentUploadedFrom.CUSTOMER_WIDGET,
    });
  }

  static async getAgentDownload(user: AgentContext, attachmentId: string) {
    const attachment = await prisma.attachment.findFirst({
      where: {
        id: attachmentId,
        companyId: user.companyId,
      },
      include: attachmentInclude,
    });

    if (!attachment) throw notFound();
    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "ATTACHMENT_DOWNLOADED",
      entityType: "ATTACHMENT",
      entityId: attachment.id,
      metadata: {
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        conversationId: attachment.conversationId,
        ticketId: attachment.ticketId,
        messageId: attachment.messageId,
      },
    });
    return this.readDownload(attachment);
  }

  static async getWidgetDownload(
    attachmentId: string,
    input: {
      publicKey: string;
      sessionToken: string;
      requestOrigin?: string;
    }
  ) {
    const attachment = await prisma.attachment.findUnique({
      where: {
        id: attachmentId,
      },
      include: attachmentInclude,
    });
    if (!attachment?.conversationId) throw notFound();

    const session = await WidgetService.authorizeConversationSession(
      input.publicKey,
      input.sessionToken,
      attachment.conversationId,
      input.requestOrigin
    );

    if (attachment.companyId !== session.companyId) throw notFound();

    await AuditLogService.record({
      companyId: session.companyId,
      action: "ATTACHMENT_DOWNLOADED",
      entityType: "ATTACHMENT",
      entityId: attachment.id,
      metadata: {
        accessScope: "widget_session",
        uploadedFrom: attachment.uploadedFrom,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        conversationId: attachment.conversationId,
        ticketId: attachment.ticketId,
        messageId: attachment.messageId,
      },
    });

    return this.readDownload(attachment);
  }

  private static async resolveAgentTarget(
    companyId: string,
    target: TargetInput
  ) {
    const suppliedTargets = [
      target.conversationId,
      target.messageId,
      target.ticketId,
    ].filter(Boolean);

    if (suppliedTargets.length !== 1) {
      throw new AppError(
        "Choose exactly one attachment target",
        HTTP_STATUS.BAD_REQUEST
      );
    }

    if (target.messageId) {
      const message = await prisma.message.findFirst({
        where: { id: target.messageId, companyId },
        include: { conversation: true },
      });
      if (!message) throw new AppError("Message not found", HTTP_STATUS.NOT_FOUND);
      return {
        messageId: message.id,
        conversationId: message.conversationId,
        customerId: message.conversation.customerId,
      };
    }

    if (target.ticketId) {
      const ticket = await prisma.ticket.findFirst({
        where: { id: target.ticketId, companyId },
        select: {
          id: true,
          conversationId: true,
          customerId: true,
        },
      });
      if (!ticket) throw new AppError("Ticket not found", HTTP_STATUS.NOT_FOUND);
      return {
        ticketId: ticket.id,
        conversationId: ticket.conversationId ?? undefined,
        customerId: ticket.customerId ?? undefined,
      };
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: target.conversationId!,
        companyId,
      },
      select: {
        id: true,
        customerId: true,
      },
    });
    if (!conversation) {
      throw new AppError("Conversation not found", HTTP_STATUS.NOT_FOUND);
    }
    return {
      conversationId: conversation.id,
      customerId: conversation.customerId,
    };
  }

  private static async persist(
    file: Express.Multer.File,
    data: {
      companyId: string;
      uploadedById?: string;
      customerId?: string;
      conversationId?: string;
      messageId?: string;
      ticketId?: string;
      uploadedFrom: AttachmentUploadedFrom;
    }
  ) {
    if (!file?.buffer?.length) {
      throw new AppError("Attachment file is required", HTTP_STATUS.BAD_REQUEST);
    }

    const storageKey = await attachmentStorage.save(file.buffer);
    try {
      const attachment = await prisma.$transaction(async (tx) => {
        const created = await tx.attachment.create({
          data: {
            ...data,
            fileName: file.originalname.slice(0, 255),
            mimeType: file.mimetype.toLowerCase(),
            fileSize: file.size,
            storageKey,
          },
          include: attachmentInclude,
        });

        if (data.conversationId) {
          await tx.conversation.update({
            where: { id: data.conversationId },
            data: { updatedAt: new Date() },
          });
        }
        if (data.ticketId) {
          await tx.ticket.update({
            where: { id: data.ticketId },
            data: { updatedAt: new Date() },
          });
        }
        return created;
      });

      const dto = mapAttachment(attachment);
      await AuditLogService.record({
        companyId: data.companyId,
        actorId: data.uploadedById ?? null,
        action: "ATTACHMENT_UPLOADED",
        entityType: "ATTACHMENT",
        entityId: dto.id,
        metadata: {
          uploadedFrom: data.uploadedFrom,
          fileName: dto.fileName,
          mimeType: dto.mimeType,
          fileSize: dto.fileSize,
          conversationId: dto.conversationId,
          ticketId: dto.ticketId,
          messageId: dto.messageId,
          customerId: dto.customerId,
        },
      });
      const io = getIO();
      io.to(`company:${data.companyId}`).emit("attachment_created", dto);
      if (data.conversationId) {
        io.to(`conversation:${data.conversationId}`).emit(
          "attachment_created",
          dto
        );
      }
      if (data.ticketId) {
        io.to(`company:${data.companyId}`).emit("ticket_updated", {
          ticketId: data.ticketId,
        });
      }
      return dto;
    } catch (error) {
      await attachmentStorage.remove(storageKey);
      throw error;
    }
  }

  private static async readDownload(
    attachment: Prisma.AttachmentGetPayload<{
      include: typeof attachmentInclude;
    }>
  ) {
    return {
      attachment: mapAttachment(attachment),
      buffer: await attachmentStorage.read(attachment.storageKey),
    };
  }
}
