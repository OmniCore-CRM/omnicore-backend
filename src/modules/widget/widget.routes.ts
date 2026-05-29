import { Router } from "express";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { WidgetController } from "./widget.controller.js";
import { createWidgetConversationSchema, createWidgetMessageSchema } from "./widget.validation.js";
import { rateLimit } from "@/core/middleware/rate-limit.middleware.js";

const router = Router();

const widgetRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyPrefix: "widget",
});

// Create public widget conversation
router.post(
  "/conversations",
  widgetRateLimit,
  validateRequest(
    createWidgetConversationSchema
  ),
  WidgetController.createWidgetConversation
);

// Send public widget message
router.post(
  "/messages",
  widgetRateLimit,
  validateRequest(
    createWidgetMessageSchema
  ),
  WidgetController.createWidgetMessage
);

export default router;
