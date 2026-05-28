import { Router } from "express";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { WidgetController } from "./widget.controller.js";
import { createWidgetConversationSchema, createWidgetMessageSchema } from "./widget.validation.js";

const router = Router();

// Create public widget conversation
router.post(
  "/conversations",
  validateRequest(
    createWidgetConversationSchema
  ),
  WidgetController.createWidgetConversation
);

// Send public widget message
router.post(
  "/messages",
  validateRequest(
    createWidgetMessageSchema
  ),
  WidgetController.createWidgetMessage
);

export default router;