import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
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
import { TeamController } from "@/modules/teams/team.controller.js";
import { assignTeamSchema } from "@/modules/teams/team.validation.js";

const router = Router();

// Create tenant-scoped conversation
router.post(
  "/",
  protect,
  authorize(...RBAC.operational),
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
  authorize(...RBAC.operational),
  validateRequest(updateConversationSchema),
  ConversationController.updateConversation
);

router.post(
  "/:id/team",
  protect,
  authorize(...RBAC.operational),
  validateRequest(assignTeamSchema),
  TeamController.assignConversation
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
  authorize(...RBAC.operational),
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
  authorize(...RBAC.operational),
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
  authorize(...RBAC.operational),
  validateRequest(createConversationTicketSchema),
  TicketController.createTicketFromConversation
);

router.post("/:id/tags", protect, authorize(...RBAC.operational), TagController.attachConversationTag);

router.delete(
  "/:id/tags/:tagId",
  protect,
  authorize(...RBAC.operational),
  TagController.removeConversationTag
);

export default router;
