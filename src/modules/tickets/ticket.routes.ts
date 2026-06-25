import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { TicketController } from "./ticket.controller.js";
import { TagController } from "@/modules/tags/tag.controller.js";
import { TeamController } from "@/modules/teams/team.controller.js";
import { assignTeamSchema } from "@/modules/teams/team.validation.js";
import {
  createTicketNoteSchema,
  createTicketSchema,
  updateTicketSchema,
} from "./ticket.validation.js";
import { AttachmentController } from "@/modules/attachments/attachment.controller.js";
import { uploadSingleAttachment } from "@/modules/attachments/attachment.upload.js";

const router = Router();

router.get("/", protect, TicketController.getTickets);

router.post(
  "/",
  protect,
  authorize(...RBAC.operational),
  validateRequest(createTicketSchema),
  TicketController.createTicket
);

router.get("/:id", protect, TicketController.getTicketById);

router.get("/:id/notes", protect, TicketController.getTicketNotes);

router.post(
  "/:id/notes",
  protect,
  authorize(...RBAC.operational),
  validateRequest(createTicketNoteSchema),
  TicketController.createTicketNote
);

router.get("/:id/activity", protect, TicketController.getTicketActivity);

router.patch(
  "/:id",
  protect,
  authorize(...RBAC.operational),
  validateRequest(updateTicketSchema),
  TicketController.updateTicket
);

router.post(
  "/:id/team",
  protect,
  authorize(...RBAC.operational),
  validateRequest(assignTeamSchema),
  TeamController.assignTicket
);

router.post("/:id/tags", protect, authorize(...RBAC.operational), TagController.attachTicketTag);

router.post(
  "/:ticketId/attachments",
  protect,
  authorize(...RBAC.operational),
  uploadSingleAttachment,
  AttachmentController.upload
);

router.delete(
  "/:id/tags/:tagId",
  protect,
  authorize(...RBAC.operational),
  TagController.removeTicketTag
);

export default router;
