import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { ConversationController } from "./conversation.controller.js";
import { createConversationSchema } from "./conversation.validation.js";
import { MessageController } from "@/modules/messages/message.controller.js";
import { createMessageSchema } from "@/modules/messages/message.validation.js";

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

export default router;