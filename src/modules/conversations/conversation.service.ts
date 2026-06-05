import { ConversationChannel, type Prisma } from "@prisma/client";
import { prisma } from "@/config/db.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import type { CreateConversationInput } from "./conversation.validation.js";
import { mapConversation, mapConversations } from "./conversation.mapper.js";
import type { PaginationParams } from "@/core/utils/pagination.js";
import { toPaginatedResult } from "@/core/utils/pagination.js";

type ConversationListParams = PaginationParams & {
  search?: unknown;
  channel?: unknown;
};

const isConversationChannel = (
  value: unknown
): value is ConversationChannel => {
  return (
    typeof value === "string" &&
    Object.values(ConversationChannel).includes(
      value as ConversationChannel
    )
  );
};

export class ConversationService {
  // ===== Create tenant-scoped conversation =====
  static async createConversation(
    companyId: string,
    data: CreateConversationInput
  ) {
    // Ensure customer belongs to authenticated tenant
    const customer = await prisma.customer.findFirst({
      where: {
        id: data.customerId,
        companyId,
      },
    });

    // Prevent foreign tenant conversation creation
    if (!customer) {
      throw new AppError(
        "Customer not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    // Create conversation under authenticated tenant
    const conversation = await prisma.conversation.create({
      data: {
        companyId,
        customerId: data.customerId,
        channel: data.channel,
      },

      include: {
        customer: true,
        tags: {
          include: {
            tag: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    return mapConversation(conversation);
  }

  // ===== Fetch conversations belonging to authenticated tenant =====
  static async getConversations(
    companyId: string,
    params: ConversationListParams
  ) {
    const search =
      typeof params.search === "string"
        ? params.search.trim()
        : "";
    const channel = isConversationChannel(params.channel)
      ? params.channel
      : undefined;

    const where: Prisma.ConversationWhereInput = {
      companyId,
      ...(channel ? { channel } : {}),
      ...(search
        ? {
            customer: {
              OR: [
                {
                  firstName: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
                {
                  lastName: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
                {
                  email: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
                {
                  phone: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
              ],
            },
          }
        : {}),
    };

    const conversations = await prisma.conversation.findMany({
      where,

      include: {
        customer: true,
        tags: {
          include: {
            tag: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },

      orderBy: [
        {
          updatedAt: "desc",
        },
        {
          id: "desc",
        },
      ],

      take: params.limit + 1,
      ...(params.cursor
        ? {
            cursor: {
              id: params.cursor,
            },
            skip: 1,
          }
        : {}),
    });

    const page = toPaginatedResult(conversations, params.limit);

    return {
      ...page,
      items: mapConversations(page.items),
    };
  }

  // ===== Fetch single tenant-scoped conversation =====
  static async getConversationById(
    companyId: string,
    conversationId: string
  ) {
    // Fetch conversation belonging to authenticated tenant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        companyId,
      },

      include: {
        customer: true,
        tags: {
          include: {
            tag: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },

        messages: {
          orderBy: [
            {
              createdAt: "asc",
            },
            {
              id: "asc",
            },
          ],
        },
      },
    });

    // Prevent foreign tenant conversation access
    if (!conversation) {
      throw new AppError(
        "Conversation not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    return mapConversation(conversation);
  }

  // ===== Placeholder conversation read handler =====
  static async markConversationAsRead(
    companyId: string,
    conversationId: string
  ) {
    // Ensure conversation belongs to authenticated tenant
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        companyId,
      },
    });

    // Prevent foreign tenant access
    if (!conversation) {
      throw new AppError(
        "Conversation not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    // Placeholder success response until unread
    // tracking infrastructure is implemented
    return {
      success: true,
    };
  }
}
