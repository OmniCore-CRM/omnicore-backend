import { Router } from "express";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { WidgetController } from "./widget.controller.js";
import {
  createWidgetConversationSchema,
  createWidgetInstallationSchema,
  createWidgetMessageSchema,
  updateWidgetInstallationSchema,
} from "./widget.validation.js";
import { rateLimit } from "@/core/middleware/rate-limit.middleware.js";
import { protect } from "@/core/middleware/auth.middleware.js";

const router = Router();

const widgetRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyPrefix: "widget",
});

router.get(
  "/installations",
  protect,
  WidgetController.getInstallations
);

router.post(
  "/installations",
  protect,
  validateRequest(createWidgetInstallationSchema),
  WidgetController.createInstallation
);

router.patch(
  "/installations/:id",
  protect,
  validateRequest(updateWidgetInstallationSchema),
  WidgetController.updateInstallation
);

router.get(
  "/bootstrap",
  widgetRateLimit,
  WidgetController.bootstrap
);

// Create public widget conversation
router.post(
  "/conversations",
  widgetRateLimit,
  validateRequest(
    createWidgetConversationSchema
  ),
  WidgetController.createWidgetConversation
);

router.get(
  "/conversations/:id/messages",
  widgetRateLimit,
  WidgetController.getWidgetMessages
);

// Send public widget message
router.post(
  "/conversations/:id/messages",
  widgetRateLimit,
  validateRequest(createWidgetMessageSchema),
  WidgetController.createWidgetMessage
);

export default router;
