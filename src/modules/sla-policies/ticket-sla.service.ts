import {
  SlaStatus,
  TicketActivityAction,
  TicketPriority,
  TicketStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { AuditLogService } from "@/modules/audit-logs/audit-log.service.js";

type SlaTicket = {
  id: string;
  companyId: string;
  createdAt: Date;
  status: TicketStatus;
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  firstRespondedAt: Date | null;
  resolvedAt: Date | null;
  slaStatus: SlaStatus;
};

const addMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * 60_000);

const isAtRisk = (createdAt: Date, dueAt: Date, now: Date) => {
  const remaining = dueAt.getTime() - now.getTime();
  const total = dueAt.getTime() - createdAt.getTime();
  const threshold = Math.max(15 * 60_000, total * 0.2);
  return remaining > 0 && remaining <= threshold;
};

const calculateStatus = (ticket: SlaTicket, now = new Date()) => {
  if (ticket.status === TicketStatus.PENDING) return SlaStatus.PAUSED;
  if (
    ticket.status === TicketStatus.RESOLVED ||
    ticket.status === TicketStatus.CLOSED
  ) {
    return ticket.slaStatus === SlaStatus.BREACHED
      ? SlaStatus.BREACHED
      : SlaStatus.ON_TRACK;
  }

  const firstResponseBreached =
    !ticket.firstRespondedAt &&
    Boolean(ticket.firstResponseDueAt && ticket.firstResponseDueAt <= now);
  const resolutionBreached = Boolean(
    !ticket.resolvedAt && ticket.resolutionDueAt && ticket.resolutionDueAt <= now
  );
  if (firstResponseBreached || resolutionBreached) return SlaStatus.BREACHED;

  const firstResponseAtRisk =
    !ticket.firstRespondedAt &&
    Boolean(
      ticket.firstResponseDueAt &&
        isAtRisk(ticket.createdAt, ticket.firstResponseDueAt, now)
    );
  const resolutionAtRisk = Boolean(
    !ticket.resolvedAt &&
      ticket.resolutionDueAt &&
      isAtRisk(ticket.createdAt, ticket.resolutionDueAt, now)
  );
  return firstResponseAtRisk || resolutionAtRisk
    ? SlaStatus.AT_RISK
    : SlaStatus.ON_TRACK;
};

export class TicketSlaService {
  static async refreshCompanyTickets(companyId: string) {
    const tickets = await prisma.ticket.findMany({
      where: {
        companyId,
        status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        OR: [
          { firstResponseDueAt: { not: null } },
          { resolutionDueAt: { not: null } },
        ],
      },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    return this.refreshTickets(
      companyId,
      tickets.map((ticket) => ticket.id)
    );
  }

  static async deadlinesForPriority(
    companyId: string,
    priority: TicketPriority,
    startAt = new Date()
  ) {
    const policy = await prisma.slaPolicy.findFirst({
      where: { companyId, priority, enabled: true },
      orderBy: { updatedAt: "desc" },
    });

    if (!policy) {
      return {
        firstResponseDueAt: null,
        resolutionDueAt: null,
        slaStatus: SlaStatus.ON_TRACK,
      };
    }

    return {
      firstResponseDueAt: addMinutes(startAt, policy.firstResponseMinutes),
      resolutionDueAt: addMinutes(startAt, policy.resolutionMinutes),
      slaStatus: SlaStatus.ON_TRACK,
    };
  }

  static async refreshTickets(
    companyId: string,
    ticketIds: string[],
    actorId?: string
  ) {
    if (ticketIds.length === 0) return false;
    const tickets = await prisma.ticket.findMany({
      where: { companyId, id: { in: ticketIds } },
      select: {
        id: true,
        companyId: true,
        createdAt: true,
        status: true,
        firstResponseDueAt: true,
        resolutionDueAt: true,
        firstRespondedAt: true,
        resolvedAt: true,
        slaStatus: true,
      },
    });

    let changed = false;
    for (const ticket of tickets) {
      const nextStatus = calculateStatus(ticket);
      if (nextStatus === ticket.slaStatus) continue;
      changed = true;

      await prisma.$transaction(async (tx) => {
        await tx.ticket.update({
          where: { id: ticket.id },
          data: { slaStatus: nextStatus },
        });

        if (actorId) {
          await tx.ticketActivity.create({
            data: {
              companyId,
              ticketId: ticket.id,
              actorId,
              action:
                nextStatus === SlaStatus.BREACHED
                  ? TicketActivityAction.SLA_BREACHED
                  : TicketActivityAction.SLA_UPDATED,
              metadata: { from: ticket.slaStatus, to: nextStatus },
            },
          });
        }
      });

      await AuditLogService.record({
        companyId,
        actorId: actorId ?? null,
        action:
          nextStatus === SlaStatus.BREACHED
            ? "TICKET_SLA_BREACHED"
            : "TICKET_SLA_UPDATED",
        entityType: "TICKET",
        entityId: ticket.id,
        metadata: { from: ticket.slaStatus, to: nextStatus },
      });
    }
    return changed;
  }

  static async recordFirstResponse(
    companyId: string,
    conversationId: string,
    actorId: string
  ) {
    const now = new Date();
    const tickets = await prisma.ticket.findMany({
      where: {
        companyId,
        conversationId,
        firstRespondedAt: null,
        status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
      },
      select: { id: true },
    });
    if (tickets.length === 0) return;

    const ids = tickets.map((ticket) => ticket.id);
    await prisma.ticket.updateMany({
      where: { companyId, id: { in: ids }, firstRespondedAt: null },
      data: { firstRespondedAt: now },
    });

    await prisma.ticketActivity.createMany({
      data: ids.map(
        (ticketId): Prisma.TicketActivityCreateManyInput => ({
          companyId,
          ticketId,
          actorId,
          action: TicketActivityAction.SLA_UPDATED,
          metadata: { firstRespondedAt: now.toISOString() },
        })
      ),
    });
    await this.refreshTickets(companyId, ids, actorId);
  }
}
