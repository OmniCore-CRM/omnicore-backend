import { Router, type Request } from "express";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { WidgetController } from "./widget.controller.js";
import {
  createWidgetConversationSchema,
  createWidgetInstallationSchema,
  createWidgetMessageSchema,
  updateWidgetInstallationSchema,
  createWidgetFaqEntrySchema,
  updateWidgetFaqEntrySchema,
} from "./widget.validation.js";
import { rateLimit } from "@/core/middleware/rate-limit.middleware.js";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { AttachmentController } from "@/modules/attachments/attachment.controller.js";
import { uploadSingleAttachment } from "@/modules/attachments/attachment.upload.js";

const router = Router();

const getClientIp = (req: Request) =>
  req.ip || req.socket.remoteAddress || "unknown";

const publicWidgetKey = (req: Request) =>
  String(req.body?.publicKey || req.query?.key || "unknown-key");

const widgetSessionKey = (req: Request) =>
  String(req.body?.sessionToken || req.query?.sessionToken || "unknown-session");

const widgetConversationKey = (req: Request) =>
  String(req.params.id || req.params.conversationId || "unknown-conversation");

const widgetBootstrapRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  keyPrefix: "widget:bootstrap",
  keyGenerator: (req) => [
    `ip:${getClientIp(req)}`,
    `key:${publicWidgetKey(req)}`,
  ],
});

const widgetConversationRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 12,
  keyPrefix: "widget:conversation",
  keyGenerator: (req) => [
    `ip:${getClientIp(req)}`,
    `key:${publicWidgetKey(req)}`,
  ],
});

const widgetReadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: "widget:read",
  keyGenerator: (req) => [
    `ip:${getClientIp(req)}`,
    `key:${publicWidgetKey(req)}`,
    `session:${widgetSessionKey(req)}`,
    `conversation:${widgetConversationKey(req)}`,
  ],
});

const widgetMessageRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  keyPrefix: "widget:message",
  keyGenerator: (req) => [
    `ip:${getClientIp(req)}`,
    `key:${publicWidgetKey(req)}`,
    `session:${widgetSessionKey(req)}`,
    `conversation:${widgetConversationKey(req)}`,
  ],
});

const widgetAttachmentRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyPrefix: "widget:attachment",
  keyGenerator: (req) => [
    `ip:${getClientIp(req)}`,
    `conversation:${widgetConversationKey(req)}`,
  ],
});

router.get(
  "/installations",
  protect,
  authorize(...RBAC.admin),
  WidgetController.getInstallations
);

router.post(
  "/installations",
  protect,
  authorize(...RBAC.admin),
  validateRequest(createWidgetInstallationSchema),
  WidgetController.createInstallation
);

router.post(
  "/conversations/:conversationId/attachments",
  widgetAttachmentRateLimit,
  uploadSingleAttachment,
  AttachmentController.uploadWidget
);

router.patch(
  "/installations/:id",
  protect,
  authorize(...RBAC.admin),
  validateRequest(updateWidgetInstallationSchema),
  WidgetController.updateInstallation
);

router.get(
  "/bootstrap",
  widgetBootstrapRateLimit,
  WidgetController.bootstrap
);

// Create public widget conversation
router.post(
  "/conversations",
  widgetConversationRateLimit,
  validateRequest(
    createWidgetConversationSchema
  ),
  WidgetController.createWidgetConversation
);

router.get(
  "/conversations/:id/messages",
  widgetReadRateLimit,
  WidgetController.getWidgetMessages
);

// Send public widget message
router.post(
  "/conversations/:id/messages",
  widgetMessageRateLimit,
  validateRequest(createWidgetMessageSchema),
  WidgetController.createWidgetMessage
);

// ===== FAQ management (admin) =====
router.get(
  "/installations/:id/faq",
  protect,
  authorize(...RBAC.admin),
  WidgetController.listFaqEntries
);

router.post(
  "/installations/:id/faq",
  protect,
  authorize(...RBAC.admin),
  validateRequest(createWidgetFaqEntrySchema),
  WidgetController.createFaqEntry
);

router.patch(
  "/installations/:id/faq/:faqId",
  protect,
  authorize(...RBAC.admin),
  validateRequest(updateWidgetFaqEntrySchema),
  WidgetController.updateFaqEntry
);

router.delete(
  "/installations/:id/faq/:faqId",
  protect,
  authorize(...RBAC.admin),
  WidgetController.deleteFaqEntry
);

export default router;
