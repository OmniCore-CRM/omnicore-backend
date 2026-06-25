import type { Prisma } from "@prisma/client";
import { prisma } from "@/config/db.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import {
  mapSavedReply,
  mapSavedReplies,
} from "./saved-reply.mapper.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import type {
  CreateSavedReplyInput,
  SavedReplyListQueryInput,
  UpdateSavedReplyInput,
} from "./saved-reply.validation.js";

const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

const savedReplyInclude = {
  createdBy: { select: safeUserSelect },
} satisfies Prisma.SavedReplyInclude;

type UserContext = {
  userId: string;
  companyId: string;
  role: string;
};

const assertCanMutate = (user: UserContext) => {
  if (user.role === "VIEWER") {
    throw new AppError(
      "Saved reply changes are not allowed for viewer users",
      HTTP_STATUS.FORBIDDEN
    );
  }
};

export class SavedReplyService {
  static async getSavedReplies(
    companyId: string,
    query: SavedReplyListQueryInput
  ) {
    const search = query.search?.trim();
    const where: Prisma.SavedReplyWhereInput = {
      companyId,
      ...(search
        ? {
            OR: [
              {
                title: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                content: {
                  contains: search,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    };

    const replies = await prisma.savedReply.findMany({
      where,
      include: savedReplyInclude,
      orderBy: [
        {
          updatedAt: "desc",
        },
        {
          id: "desc",
        },
      ],
    });

    return mapSavedReplies(replies);
  }

  static async createSavedReply(
    user: UserContext,
    data: CreateSavedReplyInput
  ) {
    assertCanMutate(user);

    const reply = await prisma.savedReply.create({
      data: {
        companyId: user.companyId,
        createdById: user.userId,
        title: data.title,
        content: data.content,
      },
      include: savedReplyInclude,
    });

    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "SAVED_REPLY_CREATED",
      entityType: "SAVED_REPLY",
      entityId: reply.id,
      metadata: {
        title: reply.title,
      },
    });

    return mapSavedReply(reply);
  }

  static async updateSavedReply(
    user: UserContext,
    replyId: string,
    data: UpdateSavedReplyInput
  ) {
    assertCanMutate(user);

    const existing = await prisma.savedReply.findFirst({
      where: {
        id: replyId,
        companyId: user.companyId,
      },
    });

    if (!existing) {
      throw new AppError("Saved reply not found", HTTP_STATUS.NOT_FOUND);
    }

    const reply = await prisma.savedReply.update({
      where: {
        id: replyId,
      },
      data,
      include: savedReplyInclude,
    });

    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "SAVED_REPLY_UPDATED",
      entityType: "SAVED_REPLY",
      entityId: reply.id,
      metadata: {
        title: reply.title,
      },
    });

    return mapSavedReply(reply);
  }

  static async deleteSavedReply(user: UserContext, replyId: string) {
    assertCanMutate(user);

    const existing = await prisma.savedReply.findFirst({
      where: {
        id: replyId,
        companyId: user.companyId,
      },
      include: savedReplyInclude,
    });

    if (!existing) {
      throw new AppError("Saved reply not found", HTTP_STATUS.NOT_FOUND);
    }

    await prisma.savedReply.delete({
      where: {
        id: replyId,
      },
    });

    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "SAVED_REPLY_DELETED",
      entityType: "SAVED_REPLY",
      entityId: existing.id,
      metadata: {
        title: existing.title,
      },
    });

    return mapSavedReply(existing);
  }
}
