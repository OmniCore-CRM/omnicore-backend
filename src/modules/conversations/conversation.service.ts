import {
  ConversationActivityAction,
  ConversationChannel,
  ConversationStatus,
  Prisma,
  UserRole,
  type Message,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { AppError } from "@/core/errors/app-error.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import {
  Permissions,
  hasPermission,
} from "@/core/permissions/permission-policy.js";
import type {
  ConversationListQueryInput,
  CreateConversationInput,
  UpdateConversationInput,
} from "./conversation.validation.js";
import {
  mapConversation,
  mapConversationActivity,
  mapConversations,
} from "./conversation.mapper.js";
import { toPaginatedResult } from "@/core/utils/pagination.js";
import { getIO } from "@/socket/socket.server.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";
import { AssignmentRuleService } from "@/modules/assignment-rules/assignment-rule.service.js";

type UserContext = {
  userId: string;
  companyId: string;
  role: string;
};

type LatestConversationMessage = Pick<
  Message,
  | "id"
  | "companyId"
  | "conversationId"
  | "sender"
  | "content"
  | "status"
  | "provider"
  | "createdAt"
  | "updatedAt"
>;

const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

const conversationListSelect = {
  id: true,
  companyId: true,
  customerId: true,
  channel: true,
  status: true,
  subject: true,
  assigneeId: true,
  teamId: true,
  createdAt: true,
  updatedAt: true,
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  },
  team: {
    select: {
      id: true,
      name: true,
      description: true,
    },
  },
  assignee: {
    select: safeUserSelect,
  },
  tags: {
    select: {
      createdAt: true,
      tag: {
        select: {
          id: true,
          companyId: true,
          name: true,
          color: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
  tickets: {
    select: {
      id: true,
      subject: true,
      status: true,
      priority: true,
      assigneeId: true,
      createdAt: true,
      updatedAt: true,
      assignee: {
        select: safeUserSelect,
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
    take: 1,
  },
} satisfies Prisma.ConversationSelect;

const conversationDetailSelect = {
  ...conversationListSelect,
  attachments: {
    orderBy: {
      createdAt: "asc",
    },
  },
  messages: {
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        id: "desc",
      },
    ],
    take: 1,
  },
} satisfies Prisma.ConversationSelect;

const assertCanMutate = (user: UserContext) => {
  if (!hasPermission(user.role as UserRole, Permissions.operationalConversationActions)) {
    throw new AppError(
      "Conversation changes are not allowed for viewer users",
      HTTP_STATUS.FORBIDDEN
    );
  }
};

const assertCanAssign = (user: UserContext) => {
  if (!hasPermission(user.role as UserRole, Permissions.assignWork)) {
    throw new AppError(
      "Conversation assignment is not allowed",
      HTTP_STATUS.FORBIDDEN
    );
  }
};

type ConversationListRow = {
  id: string;
  companyId: string;
  customerId: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  subject: string | null;
  assigneeId: string | null;
  teamId: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  };
  team: {
    id: string;
    name: string;
    description: string | null;
  } | null;
  assignee: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    displayName: string;
  } | null;
  tags: Array<{
    id: string;
    companyId: string;
    name: string;
    color: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  tickets: Array<{
    id: string;
    subject: string;
    status: string;
    priority: string;
    assigneeId: string | null;
    assignee: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: string;
      displayName: string;
    } | null;
    createdAt: string;
    updatedAt: string;
  }>;
  latestMessage: {
    id: string;
    companyId: string;
    conversationId: string;
    sender: string;
    content: string;
    status: string;
    provider: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
};

const mapConversationListRow = (row: ConversationListRow) => {
  const latestMessage = row.latestMessage;

  return {
    id: row.id,
    companyId: row.companyId,
    customerId: row.customerId,
    channel: row.channel,
    status: row.status,
    subject: row.subject,
    assigneeId: row.assigneeId,
    assignee: row.assignee,
    teamId: row.teamId,
    team: row.team,
    tickets: row.tickets ?? [],
    primaryTicket: row.tickets?.[0] ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessage: latestMessage,
    latestMessage,
    lastMessagePreview: latestMessage?.content ?? null,
    lastMessageAt: latestMessage?.createdAt ?? null,
    customer: row.customer,
    messages: latestMessage ? [latestMessage] : [],
    attachments: [],
    tags: row.tags ?? [],
    activities: undefined,
  };
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
        team: true,
        attachments: {
          where: {
            messageId: null,
          },
          include: {
            uploadedBy: { select: safeUserSelect },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
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

    await AssignmentRuleService.applyConversationRules({
      companyId,
      conversationId: conversation.id,
      channel: conversation.channel,
    });

    const routedConversation = await prisma.conversation.findFirst({
      where: { id: conversation.id, companyId },
      include: {
        customer: true,
        team: true,
        attachments: {
          include: { uploadedBy: { select: safeUserSelect } },
          orderBy: { createdAt: "asc" },
        },
        tags: {
          include: { tag: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return mapConversation(routedConversation!);
  }

  // ===== Fetch conversations belonging to authenticated tenant =====
  static async getConversations(
    companyId: string,
    params: ConversationListQueryInput
  ) {
    const search = params.search?.trim();
    const normalizedSearch = search?.toUpperCase();
    const searchStatus = Object.values(ConversationStatus).find(
      (status) => status === normalizedSearch
    );
    const linkedTicketFilter =
      params.ticketStatus || params.ticketPriority
        ? {
            companyId,
            ...(params.ticketStatus ? { status: params.ticketStatus } : {}),
            ...(params.ticketPriority
              ? { priority: params.ticketPriority }
              : {}),
          }
        : null;

    const where: Prisma.ConversationWhereInput = {
      companyId,
      ...(params.channel ? { channel: params.channel } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(linkedTicketFilter
        ? { tickets: { some: linkedTicketFilter } }
        : {}),
      ...(params.assigneeId
        ? params.assigneeId === "unassigned"
          ? { assigneeId: null }
          : { assigneeId: params.assigneeId }
        : {}),
      ...(params.teamId ? { teamId: params.teamId } : {}),
      ...(params.tagId
        ? { tags: { some: { companyId, tagId: params.tagId } } }
        : {}),
      ...(search
        ? {
            OR: [
              {
                customer: {
                  OR: [
                    {
                      id: {
                        contains: search,
                        mode: "insensitive",
                      },
                    },
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
              },
              {
                messages: {
                  some: {
                    companyId,
                    content: { contains: search, mode: "insensitive" },
                  },
                },
              },
              {
                tags: {
                  some: {
                    companyId,
                    tag: {
                      name: { contains: search, mode: "insensitive" },
                    },
                  },
                },
              },
              {
                team: {
                  name: { contains: search, mode: "insensitive" },
                },
              },
              ...(searchStatus ? [{ status: searchStatus }] : []),
            ],
          }
        : {}),
    };

    const canUseFastList =
      !search &&
      !linkedTicketFilter &&
      !params.tagId &&
      !params.cursor;

    if (canUseFastList) {
      const conditions: Prisma.Sql[] = [
        Prisma.sql`c."companyId" = ${companyId}`,
      ];

      if (params.channel) {
        conditions.push(Prisma.sql`c."channel" = ${params.channel}::"ConversationChannel"`);
      }
      if (params.status) {
        conditions.push(Prisma.sql`c."status" = ${params.status}::"ConversationStatus"`);
      }
      if (params.assigneeId) {
        if (params.assigneeId === "unassigned") {
          conditions.push(Prisma.sql`c."assigneeId" IS NULL`);
        } else {
          conditions.push(Prisma.sql`c."assigneeId" = ${params.assigneeId}`);
        }
      }
      if (params.teamId) {
        conditions.push(Prisma.sql`c."teamId" = ${params.teamId}`);
      }

      const rows = await prisma.$queryRaw<ConversationListRow[]>`
        WITH page AS (
          SELECT
            c."id",
            c."companyId",
            c."customerId",
            c."channel",
            c."status",
            c."subject",
            c."assigneeId",
            c."teamId",
            c."createdAt",
            c."updatedAt"
          FROM "Conversation" c
          WHERE ${Prisma.join(conditions, " AND ")}
          ORDER BY c."updatedAt" DESC, c."id" DESC
          LIMIT ${params.limit + 1}
        )
        SELECT
          page."id",
          page."companyId",
          page."customerId",
          page."channel",
          page."status",
          page."subject",
          page."assigneeId",
          page."teamId",
          page."createdAt",
          page."updatedAt",
          json_build_object(
            'id', customer."id",
            'firstName', customer."firstName",
            'lastName', customer."lastName",
            'email', customer."email",
            'phone', customer."phone"
          ) AS "customer",
          CASE
            WHEN team."id" IS NULL THEN NULL
            ELSE json_build_object(
              'id', team."id",
              'name', team."name",
              'description', team."description"
            )
          END AS "team",
          CASE
            WHEN assignee."id" IS NULL THEN NULL
            ELSE json_build_object(
              'id', assignee."id",
              'email', assignee."email",
              'firstName', assignee."firstName",
              'lastName', assignee."lastName",
              'role', assignee."role",
              'displayName', concat_ws(' ', assignee."firstName", assignee."lastName")
            )
          END AS "assignee",
          COALESCE(tags."items", '[]'::json) AS "tags",
          COALESCE(ticket_summary."items", '[]'::json) AS "tickets",
          latest_message."item" AS "latestMessage"
        FROM page
        JOIN "Customer" customer
          ON customer."id" = page."customerId"
         AND customer."companyId" = ${companyId}
        LEFT JOIN "Team" team
          ON team."id" = page."teamId"
         AND team."companyId" = ${companyId}
        LEFT JOIN "User" assignee
          ON assignee."id" = page."assigneeId"
         AND assignee."companyId" = ${companyId}
        LEFT JOIN LATERAL (
          SELECT json_agg(
            json_build_object(
              'id', tag."id",
              'companyId', tag."companyId",
              'name', tag."name",
              'color', tag."color",
              'createdAt', tag."createdAt",
              'updatedAt', tag."updatedAt"
            )
            ORDER BY ct."createdAt" ASC
          ) AS "items"
          FROM "ConversationTag" ct
          JOIN "Tag" tag
            ON tag."id" = ct."tagId"
           AND tag."companyId" = ${companyId}
          WHERE ct."conversationId" = page."id"
            AND ct."companyId" = ${companyId}
        ) tags ON TRUE
        LEFT JOIN LATERAL (
          SELECT json_agg(ticket_item."item") AS "items"
          FROM (
            SELECT json_build_object(
              'id', ticket."id",
              'subject', ticket."subject",
              'status', ticket."status",
              'priority', ticket."priority",
              'assigneeId', ticket."assigneeId",
              'assignee',
                CASE
                  WHEN assignee."id" IS NULL THEN NULL
                  ELSE json_build_object(
                    'id', assignee."id",
                    'email', assignee."email",
                    'firstName', assignee."firstName",
                    'lastName', assignee."lastName",
                    'role', assignee."role",
                    'displayName',
                      concat_ws(' ', assignee."firstName", assignee."lastName")
                  )
                END,
              'createdAt', ticket."createdAt",
              'updatedAt', ticket."updatedAt"
            ) AS "item"
            FROM "Ticket" ticket
            LEFT JOIN "User" assignee
              ON assignee."id" = ticket."assigneeId"
             AND assignee."companyId" = ${companyId}
            WHERE ticket."conversationId" = page."id"
              AND ticket."companyId" = ${companyId}
            ORDER BY ticket."updatedAt" DESC, ticket."id" DESC
            LIMIT 1
          ) ticket_item
        ) ticket_summary ON TRUE
        LEFT JOIN LATERAL (
          SELECT json_build_object(
            'id', message."id",
            'companyId', message."companyId",
            'conversationId', message."conversationId",
            'sender', message."sender",
            'content', message."content",
            'status', message."status",
            'provider', message."provider",
            'createdAt', message."createdAt",
            'updatedAt', message."updatedAt"
          ) AS "item"
          FROM "Message" message
          WHERE message."conversationId" = page."id"
            AND message."companyId" = ${companyId}
          ORDER BY message."createdAt" DESC, message."id" DESC
          LIMIT 1
        ) latest_message ON TRUE
        ORDER BY page."updatedAt" DESC, page."id" DESC
      `;

      const page = toPaginatedResult(rows, params.limit);
      return {
        ...page,
        items: page.items.map(mapConversationListRow),
      };
    }

    const conversations = await prisma.conversation.findMany({
      where,
      select: conversationListSelect,

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
    const conversationIds = page.items.map((conversation) => conversation.id);
    const latestMessages = conversationIds.length
      ? await prisma.$queryRaw<LatestConversationMessage[]>`
          SELECT DISTINCT ON ("conversationId")
            "id",
            "companyId",
            "conversationId",
            "sender",
            "content",
            "status",
            "provider",
            "createdAt",
            "updatedAt"
          FROM "Message"
          WHERE "companyId" = ${companyId}
            AND "conversationId" IN (${Prisma.join(conversationIds)})
          ORDER BY "conversationId", "createdAt" DESC, "id" DESC
        `
      : [];
    const latestMessageByConversationId = new Map(
      latestMessages.map((message) => [message.conversationId, message])
    );
    const items = page.items.map((conversation) => ({
      ...conversation,
      messages: latestMessageByConversationId.has(conversation.id)
        ? [latestMessageByConversationId.get(conversation.id)!]
        : [],
      attachments: [],
    }));

    return {
      ...page,
      items: mapConversations(items),
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
      select: conversationDetailSelect,
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

  static async updateConversation(
    user: UserContext,
    conversationId: string,
    data: UpdateConversationInput
  ) {
    assertCanMutate(user);

    const existing = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        companyId: user.companyId,
      },
      select: {
        id: true,
        status: true,
        assigneeId: true,
      },
    });

    if (!existing) {
      throw new AppError("Conversation not found", HTTP_STATUS.NOT_FOUND);
    }

    const assigneeId = await this.resolveConversationAssignee(
      user.companyId,
      data.assigneeId ?? undefined
    );
    const statusChanged =
      data.status !== undefined && existing.status !== data.status;
    const assigneeChanged =
      data.assigneeId !== undefined && existing.assigneeId !== assigneeId;

    if (assigneeChanged) {
      assertCanAssign(user);
    }

    if (statusChanged || assigneeChanged) {
      await prisma.$transaction(async (tx) => {
        await tx.conversation.update({
          where: {
            id: existing.id,
          },
          data: {
            ...(data.status !== undefined ? { status: data.status } : {}),
            ...(data.assigneeId !== undefined ? { assigneeId } : {}),
          },
        });

        if (statusChanged) {
          await tx.conversationActivity.create({
            data: {
              companyId: user.companyId,
              conversationId: existing.id,
              actorId: user.userId,
              action: ConversationActivityAction.STATUS_CHANGED,
              metadata: {
                from: existing.status,
                to: data.status,
              },
            },
          });
        }
      });
    }

    const conversation = await this.getConversationById(
      user.companyId,
      existing.id
    );
    if (statusChanged || assigneeChanged) {
      getIO()
        .to(`company:${user.companyId}`)
        .emit("conversation:updated", conversation);
    }

    if (statusChanged) {
      await AuditLogService.record({
        companyId: user.companyId,
        actorId: user.userId,
        action: "CONVERSATION_STATUS_CHANGED",
        entityType: "CONVERSATION",
        entityId: existing.id,
        metadata: {
          from: existing.status,
          to: data.status,
        },
      });
    }

    if (assigneeChanged) {
      await AuditLogService.record({
        companyId: user.companyId,
        actorId: user.userId,
        action: assigneeId
          ? "CONVERSATION_ASSIGNED"
          : "CONVERSATION_UNASSIGNED",
        entityType: "CONVERSATION",
        entityId: existing.id,
        metadata: {
          from: existing.assigneeId,
          to: assigneeId,
        },
      });
    }

    return conversation;
  }

  private static async resolveConversationAssignee(
    companyId: string,
    assigneeId?: string | null
  ) {
    if (assigneeId === undefined) {
      return undefined;
    }

    if (assigneeId === null) {
      return null;
    }

    const assignee = await prisma.user.findFirst({
      where: {
        id: assigneeId,
        companyId,
      },
      select: {
        id: true,
      },
    });

    if (!assignee) {
      throw new AppError("Assignee not found", HTTP_STATUS.NOT_FOUND);
    }

    return assignee.id;
  }

  static async getConversationActivity(
    companyId: string,
    conversationId: string
  ) {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        companyId,
      },
      select: {
        id: true,
      },
    });

    if (!conversation) {
      throw new AppError("Conversation not found", HTTP_STATUS.NOT_FOUND);
    }

    const activities = await prisma.conversationActivity.findMany({
      where: {
        companyId,
        conversationId,
      },
      include: {
        actor: { select: safeUserSelect },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return activities.map(mapConversationActivity);
  }

  // ===== Placeholder conversation read handler =====
  static async markConversationAsRead(
    companyId: string,
    conversationId: string
  ) {
    // Ensure conversation belongs to authenticated tenant
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
      select: {
        id: true,
        companyId: true,
      },
    });

    // Prevent foreign tenant access
    if (!conversation || conversation.companyId !== companyId) {
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
