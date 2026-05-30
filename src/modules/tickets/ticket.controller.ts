import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { TicketService } from "./ticket.service.js";
import { ticketListQuerySchema } from "./ticket.validation.js";

const getUserContext = (req: AuthenticatedRequest) => ({
  userId: req.user!.userId,
  companyId: req.user!.companyId,
  role: req.user!.role,
});

export class TicketController {
  static getTickets = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const query = ticketListQuerySchema.parse(req.query);
      const tickets = await TicketService.getTickets(
        req.user!.companyId,
        query
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Tickets retrieved successfully",
        data: tickets,
      });
    }
  );

  static createTicket = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const ticket = await TicketService.createTicket(
        getUserContext(req),
        req.body
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Ticket created successfully",
        data: ticket,
      });
    }
  );

  static getTicketById = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const ticket = await TicketService.getTicketById(
        req.user!.companyId,
        req.params.id as string
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Ticket retrieved successfully",
        data: ticket,
      });
    }
  );

  static updateTicket = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const ticket = await TicketService.updateTicket(
        getUserContext(req),
        req.params.id as string,
        req.body
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Ticket updated successfully",
        data: ticket,
      });
    }
  );

  static getTicketNotes = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const notes = await TicketService.getTicketNotes(
        req.user!.companyId,
        req.params.id as string
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Ticket notes retrieved successfully",
        data: notes,
      });
    }
  );

  static createTicketNote = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const note = await TicketService.createTicketNote(
        getUserContext(req),
        req.params.id as string,
        req.body
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Ticket note created successfully",
        data: note,
      });
    }
  );

  static getTicketActivity = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const activity = await TicketService.getTicketActivity(
        req.user!.companyId,
        req.params.id as string
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.OK,
        message: "Ticket activity retrieved successfully",
        data: activity,
      });
    }
  );

  static createTicketFromConversation = asyncHandler(
    async (req: AuthenticatedRequest, res: Response) => {
      const ticket = await TicketService.createTicketFromConversation(
        getUserContext(req),
        req.params.id as string,
        req.body
      );

      return sendResponse({
        res,
        statusCode: HTTP_STATUS.CREATED,
        message: "Ticket created successfully",
        data: ticket,
      });
    }
  );
}
