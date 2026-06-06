import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { ConversationController } from "./conversation.controller.js";
import {
  createConversationSchema,
  updateConversationSchema,
} from "./conversation.validation.js";
import { MessageController } from "@/modules/messages/message.controller.js";
import { createMessageSchema } from "@/modules/messages/message.validation.js";
import { TicketController } from "@/modules/tickets/ticket.controller.js";
import { createConversationTicketSchema } from "@/modules/tickets/ticket.validation.js";
import { TagController } from "@/modules/tags/tag.controller.js";

const router = Router();

// Create tenant-scoped conversation
router.post(
  "/",
  protect,
  validateRequest(createConversationSchema),
  ConversationController.createConversation
);

// Fetch tenant-scoped conversations
router.get(
  "/",
  protect,
  ConversationController.getConversations
);

// Fetch single tenant-scoped conversation
router.get(
  "/:id",
  protect,
  ConversationController.getConversationById
);

router.patch(
  "/:id",
  protect,
  validateRequest(updateConversationSchema),
  ConversationController.updateConversation
);

router.get(
  "/:id/activity",
  protect,
  ConversationController.getConversationActivity
);

// Placeholder conversation read endpoint
router.post(
  "/:id/read",
  protect,
  ConversationController.markConversationAsRead
);

// Fetch tenant-scoped conversation messages
router.get(
  "/:id/messages",
  protect,
  MessageController.getConversationMessages
);

// Create tenant-scoped conversation message (outbound)
router.post(
  "/:id/messages",
  protect,
  (req, _res, next) => {
    // Populate parameters expected by validation/service layers
    req.body.conversationId = req.params.id;
    req.body.sender = "AGENT";
    next();
  },
  validateRequest(createMessageSchema),
  MessageController.createMessage
);

router.post(
  "/:id/tickets",
  protect,
  validateRequest(createConversationTicketSchema),
  TicketController.createTicketFromConversation
);

router.post("/:id/tags", protect, TagController.attachConversationTag);

router.delete(
  "/:id/tags/:tagId",
  protect,
  TagController.removeConversationTag
);

export default router;
