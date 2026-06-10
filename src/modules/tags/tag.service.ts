import { Prisma } from "@prisma/client";
import { prisma } from "@/config/db.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import { mapTag, mapTags } from "./tag.mapper.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import type {
  CreateTagInput,
  TagListQueryInput,
  UpdateTagInput,
} from "./tag.validation.js";

type UserContext = {
  userId: string;
  companyId: string;
  role: string;
};

type TagTargetType = "customer" | "conversation" | "ticket";

const viewerMutationError = new AppError(
  "Tag changes are not allowed for viewer users",
  HTTP_STATUS.FORBIDDEN
);

const assertCanMutate = (user: UserContext) => {
  if (user.role === "VIEWER") {
    throw viewerMutationError;
  }
};

const normalizeName = (value: string) => value.trim();

const uniqueTagError = new AppError(
  "A tag with this name already exists",
  HTTP_STATUS.CONFLICT
);

export class TagService {
  static async getTags(companyId: string, query: TagListQueryInput) {
    const search = query.search?.trim();
    const tags = await prisma.tag.findMany({
      where: {
        companyId,
        ...(search
          ? {
              name: {
                contains: search,
                mode: "insensitive",
              },
            }
          : {}),
      },
      orderBy: [
        {
          name: "asc",
        },
        {
          id: "asc",
        },
      ],
    });

    return mapTags(tags);
  }

  static async createTag(user: UserContext, data: CreateTagInput) {
    assertCanMutate(user);

    try {
      const tag = await prisma.tag.create({
        data: {
          companyId: user.companyId,
          name: normalizeName(data.name),
          color: data.color ?? null,
        },
      });

      await AuditLogService.record({
        companyId: user.companyId,
        actorId: user.userId,
        action: "TAG_CREATED",
        entityType: "TAG",
        entityId: tag.id,
        metadata: {
          name: tag.name,
          color: tag.color,
        },
      });

      return mapTag(tag);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw uniqueTagError;
      }

      throw error;
    }
  }

  static async updateTag(
    user: UserContext,
    tagId: string,
    data: UpdateTagInput
  ) {
    assertCanMutate(user);
    await this.assertTagExists(user.companyId, tagId);

    try {
      const tag = await prisma.tag.update({
        where: {
          id: tagId,
        },
        data: {
          ...(data.name !== undefined
            ? { name: normalizeName(data.name) }
            : {}),
          ...(data.color !== undefined ? { color: data.color } : {}),
        },
      });

      await AuditLogService.record({
        companyId: user.companyId,
        actorId: user.userId,
        action: "TAG_UPDATED",
        entityType: "TAG",
        entityId: tag.id,
        metadata: {
          name: tag.name,
          color: tag.color,
        },
      });

      return mapTag(tag);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw uniqueTagError;
      }

      throw error;
    }
  }

  static async deleteTag(user: UserContext, tagId: string) {
    assertCanMutate(user);
    const existing = await this.assertTagExists(user.companyId, tagId);

    await prisma.tag.delete({
      where: {
        id: tagId,
      },
    });

    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "TAG_DELETED",
      entityType: "TAG",
      entityId: existing.id,
      metadata: {
        name: existing.name,
      },
    });

    return mapTag(existing);
  }

  static async attachTag(
    user: UserContext,
    targetType: TagTargetType,
    targetId: string,
    tagId: string
  ) {
    assertCanMutate(user);
    const tag = await this.assertTagExists(user.companyId, tagId);
    await this.assertTargetExists(user.companyId, targetType, targetId);

    if (targetType === "customer") {
      await prisma.customerTag.upsert({
        where: {
          customerId_tagId: {
            customerId: targetId,
            tagId,
          },
        },
        create: {
          companyId: user.companyId,
          customerId: targetId,
          tagId,
        },
        update: {},
      });
    }

    if (targetType === "conversation") {
      await prisma.conversationTag.upsert({
        where: {
          conversationId_tagId: {
            conversationId: targetId,
            tagId,
          },
        },
        create: {
          companyId: user.companyId,
          conversationId: targetId,
          tagId,
        },
        update: {},
      });
    }

    if (targetType === "ticket") {
      await prisma.ticketTag.upsert({
        where: {
          ticketId_tagId: {
            ticketId: targetId,
            tagId,
          },
        },
        create: {
          companyId: user.companyId,
          ticketId: targetId,
          tagId,
        },
        update: {},
      });
    }

    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "TAG_ATTACHED",
      entityType: targetType.toUpperCase(),
      entityId: targetId,
      metadata: {
        tagId,
        tagName: tag.name,
      },
    });

    return mapTag(tag);
  }

  static async removeTag(
    user: UserContext,
    targetType: TagTargetType,
    targetId: string,
    tagId: string
  ) {
    assertCanMutate(user);
    const tag = await this.assertTagExists(user.companyId, tagId);
    await this.assertTargetExists(user.companyId, targetType, targetId);

    if (targetType === "customer") {
      await prisma.customerTag.deleteMany({
        where: {
          companyId: user.companyId,
          customerId: targetId,
          tagId,
        },
      });
    }

    if (targetType === "conversation") {
      await prisma.conversationTag.deleteMany({
        where: {
          companyId: user.companyId,
          conversationId: targetId,
          tagId,
        },
      });
    }

    if (targetType === "ticket") {
      await prisma.ticketTag.deleteMany({
        where: {
          companyId: user.companyId,
          ticketId: targetId,
          tagId,
        },
      });
    }

    await AuditLogService.record({
      companyId: user.companyId,
      actorId: user.userId,
      action: "TAG_REMOVED",
      entityType: targetType.toUpperCase(),
      entityId: targetId,
      metadata: {
        tagId,
        tagName: tag.name,
      },
    });

    return mapTag(tag);
  }

  private static async assertTagExists(companyId: string, tagId: string) {
    const tag = await prisma.tag.findFirst({
      where: {
        id: tagId,
        companyId,
      },
    });

    if (!tag) {
      throw new AppError("Tag not found", HTTP_STATUS.NOT_FOUND);
    }

    return tag;
  }

  private static async assertTargetExists(
    companyId: string,
    targetType: TagTargetType,
    targetId: string
  ) {
    let target: { id: string } | null = null;

    if (targetType === "customer") {
      target = await prisma.customer.findFirst({
        where: {
          id: targetId,
          companyId,
        },
        select: {
          id: true,
        },
      });
    }

    if (targetType === "conversation") {
      target = await prisma.conversation.findFirst({
        where: {
          id: targetId,
          companyId,
        },
        select: {
          id: true,
        },
      });
    }

    if (targetType === "ticket") {
      target = await prisma.ticket.findFirst({
        where: {
          id: targetId,
          companyId,
        },
        select: {
          id: true,
        },
      });
    }

    if (!target) {
      throw new AppError("Resource not found", HTTP_STATUS.NOT_FOUND);
    }
  }
}
