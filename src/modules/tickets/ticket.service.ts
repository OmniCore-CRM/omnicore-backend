import {
  TicketActivityAction,
  TicketPriority,
  TicketStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import { getIO } from "@/socket/socket.server.js";
import { toPaginatedResult } from "@/core/utils/pagination.js";
import {
  mapTicket,
  mapTicketActivities,
  mapTicketNotes,
  mapTickets,
} from "./ticket.mapper.js";
import type {
  CreateConversationTicketInput,
  CreateTicketNoteInput,
  CreateTicketInput,
  TicketListQueryInput,
  UpdateTicketInput,
} from "./ticket.validation.js";

const ticketInclude = {
  assignee: true,
  team: true,
  createdBy: true,
  customer: true,
  conversation: true,
  tags: {
    include: {
      tag: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  },
} satisfies Prisma.TicketInclude;

const ticketDetailInclude = {
  ...ticketInclude,
  conversation: {
    include: {
      messages: {
        orderBy: [
          {
            createdAt: "desc",
          },
          {
            id: "desc",
          },
        ],
        take: 50,
      },
    },
  },
  notes: {
    include: {
      author: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  },
  activities: {
    include: {
      actor: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  },
  attachments: {
    include: {
      uploadedBy: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  },
} satisfies Prisma.TicketInclude;

const viewerMutationError = new AppError(
  "Ticket changes are not allowed for viewer users",
  HTTP_STATUS.FORBIDDEN
);

type UserContext = {
  userId: string;
  companyId: string;
  role: string;
};

const assertCanMutate = (user: UserContext) => {
  if (user.role === "VIEWER") {
    throw viewerMutationError;
  }
};

const allowedStatusTransitions: Record<TicketStatus, TicketStatus[]> = {
  [TicketStatus.OPEN]: [TicketStatus.PENDING, TicketStatus.ESCALATED],
  [TicketStatus.PENDING]: [TicketStatus.OPEN, TicketStatus.RESOLVED],
  [TicketStatus.ESCALATED]: [TicketStatus.PENDING, TicketStatus.RESOLVED],
  [TicketStatus.RESOLVED]: [TicketStatus.CLOSED],
  [TicketStatus.CLOSED]: [],
};

const assertValidStatusTransition = (
  from: TicketStatus,
  to: TicketStatus
) => {
  if (from === to) return;

  if (!allowedStatusTransitions[from].includes(to)) {
    throw new AppError(
      `Invalid ticket status transition from ${from} to ${to}`,
      HTTP_STATUS.BAD_REQUEST
    );
  }
};

export class TicketService {
  static async getTickets(
    companyId: string,
    query: TicketListQueryInput
  ) {
    const search = query.search?.trim();
    const normalizedSearch = search?.toUpperCase();
    const searchStatus = Object.values(TicketStatus).find(
      (status) => status === normalizedSearch
    );
    const searchPriority = Object.values(TicketPriority).find(
      (priority) => priority === normalizedSearch
    );
    const where: Prisma.TicketWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assigneeId
        ? { assigneeId: query.assigneeId }
        : {}),
      ...(query.teamId ? { teamId: query.teamId } : {}),
      ...(query.tagId
        ? { tags: { some: { companyId, tagId: query.tagId } } }
        : {}),
      ...(search
        ? {
            OR: [
              {
                id: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                subject: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
                description: {
                  contains: search,
                  mode: "insensitive",
                },
              },
              {
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
              ...(searchPriority ? [{ priority: searchPriority }] : []),
            ],
          }
        : {}),
    };

    const tickets = await prisma.ticket.findMany({
      where,
      include: ticketInclude,
      orderBy: [
        {
          updatedAt: "desc",
        },
        {
          id: "desc",
        },
      ],
      take: query.limit + 1,
      ...(query.cursor
        ? {
            cursor: {
              id: query.cursor,
            },
            skip: 1,
          }
        : {}),
    });

    const page = toPaginatedResult(tickets, query.limit);

    return {
      ...page,
      items: mapTickets(page.items),
    };
  }

  static async getTicketById(companyId: string, ticketId: string) {
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: ticketId,
        companyId,
      },
      include: ticketDetailInclude,
    });

    if (!ticket) {
      throw new AppError("Ticket not found", HTTP_STATUS.NOT_FOUND);
    }

    return mapTicket(ticket);
  }

  static async createTicket(
    user: UserContext,
    data: CreateTicketInput
  ) {
    assertCanMutate(user);

    const links = await this.resolveTicketLinks(user.companyId, {
      customerId: data.customerId ?? undefined,
      conversationId: data.conversationId ?? undefined,
      assigneeId: data.assigneeId ?? undefined,
    });

    const createdTicketId = await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          companyId: user.companyId,
          createdById: user.userId,
          subject: data.subject,
          description: data.description,
          status: data.status,
          priority: data.priority,
          customerId: links.customerId,
          conversationId: links.conversationId,
          assigneeId: links.assigneeId,
        },
        select: {
          id: true,
          status: true,
          priority: true,
          assigneeId: true,
        },
      });

      await tx.ticketActivity.create({
        data: {
          companyId: user.companyId,
          ticketId: created.id,
          actorId: user.userId,
          action: TicketActivityAction.TICKET_CREATED,
          metadata: {
            status: created.status,
            priority: created.priority,
            assigneeId: created.assigneeId,
          },
        },
      });

      if (created.assigneeId) {
        await tx.ticketActivity.create({
          data: {
            companyId: user.companyId,
            ticketId: created.id,
            actorId: user.userId,
            action: TicketActivityAction.ASSIGNED,
            metadata: {
              assigneeId: created.assigneeId,
            },
          },
        });
      }

      return created.id;
    });

    const ticket = await this.findTicketForList(user.companyId, createdTicketId);

    const dto = mapTicket(ticket);
    getIO().to(`company:${user.companyId}`).emit("ticket_created", dto);

    return dto;
  }

  static async createTicketFromConversation(
    user: UserContext,
    conversationId: string,
    data: CreateConversationTicketInput
  ) {
    assertCanMutate(user);

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        companyId: user.companyId,
      },
      select: {
        id: true,
        customerId: true,
      },
    });

    if (!conversation) {
      throw new AppError(
        "Conversation not found",
        HTTP_STATUS.NOT_FOUND
      );
    }

    const links = await this.resolveTicketLinks(user.companyId, {
      customerId: conversation.customerId,
      conversationId: conversation.id,
      assigneeId: data.assigneeId ?? undefined,
    });

    const updatedTicketId = await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          companyId: user.companyId,
          createdById: user.userId,
          subject: data.subject,
          description: data.description,
          priority: data.priority,
          customerId: links.customerId,
          conversationId: links.conversationId,
          assigneeId: links.assigneeId,
        },
        select: {
          id: true,
          priority: true,
          assigneeId: true,
          customerId: true,
        },
      });

      await tx.ticketActivity.create({
        data: {
          companyId: user.companyId,
          ticketId: created.id,
          actorId: user.userId,
          action: TicketActivityAction.TICKET_CREATED,
          metadata: {
            source: "conversation",
            conversationId,
            customerId: created.customerId,
            priority: created.priority,
          },
        },
      });

      if (created.assigneeId) {
        await tx.ticketActivity.create({
          data: {
            companyId: user.companyId,
            ticketId: created.id,
            actorId: user.userId,
            action: TicketActivityAction.ASSIGNED,
            metadata: {
              assigneeId: created.assigneeId,
            },
          },
        });
      }

      return created.id;
    });

    const ticket = await this.findTicketForList(user.companyId, updatedTicketId);

    const dto = mapTicket(ticket);
    getIO().to(`company:${user.companyId}`).emit("ticket_created", dto);

    return dto;
  }

  static async updateTicket(
    user: UserContext,
    ticketId: string,
    data: UpdateTicketInput
  ) {
    assertCanMutate(user);

    const existing = await prisma.ticket.findFirst({
      where: {
        id: ticketId,
        companyId: user.companyId,
      },
      select: {
        id: true,
        status: true,
        priority: true,
        assigneeId: true,
      },
    });

    if (!existing) {
      throw new AppError("Ticket not found", HTTP_STATUS.NOT_FOUND);
    }

    if (data.status !== undefined) {
      assertValidStatusTransition(existing.status, data.status);
    }

    const links = await this.resolveTicketLinks(user.companyId, {
      assigneeId: data.assigneeId ?? undefined,
    });

    const updatedTicketId = await prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: {
          id: existing.id,
        },
        data: {
          ...(data.subject !== undefined
            ? { subject: data.subject }
            : {}),
          ...(data.description !== undefined
            ? { description: data.description }
            : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.priority !== undefined
            ? { priority: data.priority }
            : {}),
          ...(data.assigneeId !== undefined
            ? { assigneeId: links.assigneeId }
            : {}),
        },
        select: {
          id: true,
        },
      });

      const activities: Prisma.TicketActivityCreateManyInput[] = [];

      if (data.status !== undefined && data.status !== existing.status) {
        activities.push({
          companyId: user.companyId,
          ticketId: existing.id,
          actorId: user.userId,
          action: TicketActivityAction.STATUS_CHANGED,
          metadata: {
            from: existing.status,
            to: data.status,
          },
        });
      }

      if (
        data.priority !== undefined &&
        data.priority !== existing.priority
      ) {
        activities.push({
          companyId: user.companyId,
          ticketId: existing.id,
          actorId: user.userId,
          action: TicketActivityAction.PRIORITY_CHANGED,
          metadata: {
            from: existing.priority,
            to: data.priority,
          },
        });
      }

      if (
        data.assigneeId !== undefined &&
        links.assigneeId !== existing.assigneeId
      ) {
        activities.push({
          companyId: user.companyId,
          ticketId: existing.id,
          actorId: user.userId,
          action: links.assigneeId
            ? TicketActivityAction.ASSIGNED
            : TicketActivityAction.UNASSIGNED,
          metadata: {
            from: existing.assigneeId,
            to: links.assigneeId,
          },
        });
      }

      if (
        activities.length === 0 &&
        (data.subject !== undefined || data.description !== undefined)
      ) {
        activities.push({
          companyId: user.companyId,
          ticketId: existing.id,
          actorId: user.userId,
          action: TicketActivityAction.TICKET_UPDATED,
          metadata: {},
        });
      }

      if (activities.length > 0) {
        await tx.ticketActivity.createMany({
          data: activities,
        });
      }

      return updated.id;
    });

    const ticket = await this.findTicketForList(user.companyId, updatedTicketId);

    const dto = mapTicket(ticket);
    getIO().to(`company:${user.companyId}`).emit("ticket_updated", dto);

    return dto;
  }

  static async getTicketNotes(companyId: string, ticketId: string) {
    await this.assertTicketExists(companyId, ticketId);

    const notes = await prisma.ticketNote.findMany({
      where: {
        companyId,
        ticketId,
      },
      include: {
        author: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return mapTicketNotes(notes);
  }

  static async createTicketNote(
    user: UserContext,
    ticketId: string,
    data: CreateTicketNoteInput
  ) {
    assertCanMutate(user);
    await this.assertTicketExists(user.companyId, ticketId);

    const note = await prisma.$transaction(async (tx) => {
      const created = await tx.ticketNote.create({
        data: {
          companyId: user.companyId,
          ticketId,
          authorId: user.userId,
          content: data.content,
        },
        include: {
          author: true,
        },
      });

      await tx.ticketActivity.create({
        data: {
          companyId: user.companyId,
          ticketId,
          actorId: user.userId,
          action: TicketActivityAction.NOTE_ADDED,
          metadata: {
            noteId: created.id,
          },
        },
      });

      return created;
    });

    const dto = mapTicketNotes([note])[0];
    getIO().to(`company:${user.companyId}`).emit("ticket_note_added", dto);

    return dto;
  }

  static async getTicketActivity(companyId: string, ticketId: string) {
    await this.assertTicketExists(companyId, ticketId);

    const activities = await prisma.ticketActivity.findMany({
      where: {
        companyId,
        ticketId,
      },
      include: {
        actor: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return mapTicketActivities(activities);
  }

  private static async resolveTicketLinks(
    companyId: string,
    links: {
      customerId?: string | null;
      conversationId?: string | null;
      assigneeId?: string | null;
    }
  ) {
    let customerId = links.customerId ?? null;
    const conversationId = links.conversationId ?? null;
    const assigneeId = links.assigneeId ?? null;

    if (conversationId) {
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          companyId,
        },
        select: {
          id: true,
          customerId: true,
        },
      });

      if (!conversation) {
        throw new AppError(
          "Conversation not found",
          HTTP_STATUS.NOT_FOUND
        );
      }

      if (customerId && customerId !== conversation.customerId) {
        throw new AppError(
          "Conversation does not belong to customer",
          HTTP_STATUS.BAD_REQUEST
        );
      }

      customerId = conversation.customerId;
    }

    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          companyId,
        },
        select: {
          id: true,
        },
      });

      if (!customer) {
        throw new AppError(
          "Customer not found",
          HTTP_STATUS.NOT_FOUND
        );
      }
    }

    if (assigneeId) {
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
        throw new AppError(
          "Assignee not found",
          HTTP_STATUS.NOT_FOUND
        );
      }
    }

    return {
      customerId,
      conversationId,
      assigneeId,
    };
  }

  private static async assertTicketExists(
    companyId: string,
    ticketId: string
  ) {
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: ticketId,
        companyId,
      },
      select: {
        id: true,
      },
    });

    if (!ticket) {
      throw new AppError("Ticket not found", HTTP_STATUS.NOT_FOUND);
    }
  }

  private static async findTicketForList(companyId: string, ticketId: string) {
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: ticketId,
        companyId,
      },
      include: ticketInclude,
    });

    if (!ticket) {
      throw new AppError("Ticket not found", HTTP_STATUS.NOT_FOUND);
    }

    return ticket;
  }
}
