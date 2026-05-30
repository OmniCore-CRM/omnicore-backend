import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { TicketController } from "./ticket.controller.js";
import {
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

router.patch(
  "/:id",
  protect,
  validateRequest(updateTicketSchema),
  TicketController.updateTicket
);

export default router;
