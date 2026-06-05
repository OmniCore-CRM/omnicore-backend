import type { SavedReply, User } from "@prisma/client";

type SavedReplyWithCreator = SavedReply & {
  createdBy?: User | null;
};

const mapUserSummary = (user?: User | null) => {
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    displayName: [user.firstName, user.lastName].filter(Boolean).join(" "),
  };
};

export const mapSavedReply = (reply: SavedReplyWithCreator) => ({
  id: reply.id,
  companyId: reply.companyId,
  title: reply.title,
  content: reply.content,
  createdById: reply.createdById,
  createdBy: mapUserSummary(reply.createdBy),
  createdAt: reply.createdAt,
  updatedAt: reply.updatedAt,
});

export const mapSavedReplies = (replies: SavedReplyWithCreator[]) =>
  replies.map(mapSavedReply);
