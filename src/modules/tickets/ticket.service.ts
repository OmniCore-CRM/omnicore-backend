import type { Prisma } from "@prisma/client";
import { prisma } from "@/config/db.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import { getIO } from "@/socket/socket.server.js";
import { toPaginatedResult } from "@/core/utils/pagination.js";
import { mapTicket, mapTickets } from "./ticket.mapper.js";
import type {
  CreateConversationTicketInput,
  CreateTicketInput,
  TicketListQueryInput,
  UpdateTicketInput,
} from "./ticket.validation.js";

const ticketInclude = {
  assignee: true,
  createdBy: true,
  customer: true,
  conversation: true,
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

export class TicketService {
  static async getTickets(
    companyId: string,
    query: TicketListQueryInput
  ) {
    const search = query.search?.trim();
    const where: Prisma.TicketWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assigneeId
        ? { assigneeId: query.assigneeId }
        : {}),
      ...(search
        ? {
            OR: [
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
      include: ticketInclude,
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

    const ticket = await prisma.ticket.create({
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
      include: ticketInclude,
    });

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

    const ticket = await prisma.ticket.create({
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
      include: ticketInclude,
    });

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
      },
    });

    if (!existing) {
      throw new AppError("Ticket not found", HTTP_STATUS.NOT_FOUND);
    }

    const links = await this.resolveTicketLinks(user.companyId, {
      assigneeId: data.assigneeId ?? undefined,
    });

    const ticket = await prisma.ticket.update({
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
      include: ticketInclude,
    });

    const dto = mapTicket(ticket);
    getIO().to(`company:${user.companyId}`).emit("ticket_updated", dto);

    return dto;
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
}
