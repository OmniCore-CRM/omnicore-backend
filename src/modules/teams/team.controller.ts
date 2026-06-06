import type { Response } from "express";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { asyncHandler } from "@/core/utils/async-handler.js";
import { sendResponse } from "@/core/utils/send-response.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { TeamService } from "./team.service.js";

const context = (req: AuthenticatedRequest) => ({
  userId: req.user!.userId,
  companyId: req.user!.companyId,
  role: req.user!.role,
});

export class TeamController {
  static list = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({ res, message: "Teams retrieved successfully", data: await TeamService.list(req.user!.companyId) }));
  static create = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({ res, statusCode: HTTP_STATUS.CREATED, message: "Team created successfully", data: await TeamService.create(context(req), req.body) }));
  static update = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({ res, message: "Team updated successfully", data: await TeamService.update(context(req), req.params.id as string, req.body) }));
  static remove = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({ res, message: "Team deleted successfully", data: await TeamService.remove(context(req), req.params.id as string) }));
  static addMember = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({ res, message: "Team member added successfully", data: await TeamService.addMember(context(req), req.params.id as string, req.body.userId) }));
  static removeMember = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({ res, message: "Team member removed successfully", data: await TeamService.removeMember(context(req), req.params.id as string, req.params.userId as string) }));
  static assignTicket = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({ res, message: "Ticket team updated successfully", data: await TeamService.assignTicket(context(req), req.params.id as string, req.body) }));
  static assignConversation = asyncHandler(async (req: AuthenticatedRequest, res: Response) =>
    sendResponse({ res, message: "Conversation team updated successfully", data: await TeamService.assignConversation(context(req), req.params.id as string, req.body) }));
}
