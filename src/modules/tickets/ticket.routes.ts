import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { TicketController } from "./ticket.controller.js";
import { TagController } from "@/modules/tags/tag.controller.js";
import {
  createTicketNoteSchema,
  createTicketSchema,
  updateTicketSchema,
} from "./ticket.validation.js";

const router = Router();

router.get("/", protect, TicketController.getTickets);

router.post(
  "/",
  protect,
  validateRequest(createTicketSchema),
  TicketController.createTicket
);

router.get("/:id", protect, TicketController.getTicketById);

router.get("/:id/notes", protect, TicketController.getTicketNotes);

router.post(
  "/:id/notes",
  protect,
  validateRequest(createTicketNoteSchema),
  TicketController.createTicketNote
);

router.get("/:id/activity", protect, TicketController.getTicketActivity);

router.patch(
  "/:id",
  protect,
  validateRequest(updateTicketSchema),
  TicketController.updateTicket
);

router.post("/:id/tags", protect, TagController.attachTicketTag);

router.delete(
  "/:id/tags/:tagId",
  protect,
  TagController.removeTicketTag
);

export default router;
