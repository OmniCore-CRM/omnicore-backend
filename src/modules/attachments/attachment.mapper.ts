import type { Attachment, User } from "@prisma/client";

type AttachmentUploader = Pick<User, "id" | "firstName" | "lastName">;

type AttachmentWithUploader = Attachment & {
  uploadedBy?: AttachmentUploader | null;
};

export const mapAttachment = (attachment: AttachmentWithUploader) => ({
  id: attachment.id,
  uploadedById: attachment.uploadedById,
  uploadedBy: attachment.uploadedBy
    ? {
        id: attachment.uploadedBy.id,
        firstName: attachment.uploadedBy.firstName,
        lastName: attachment.uploadedBy.lastName,
        displayName: [
          attachment.uploadedBy.firstName,
          attachment.uploadedBy.lastName,
        ]
          .filter(Boolean)
          .join(" "),
      }
    : null,
  customerId: attachment.customerId,
  conversationId: attachment.conversationId,
  messageId: attachment.messageId,
  ticketId: attachment.ticketId,
  fileName: attachment.fileName,
  mimeType: attachment.mimeType,
  fileSize: attachment.fileSize,
  uploadedFrom: attachment.uploadedFrom,
  downloadUrl: `/attachments/${attachment.id}`,
  createdAt: attachment.createdAt,
});

export const mapAttachments = (attachments: AttachmentWithUploader[]) =>
  attachments.map(mapAttachment);
