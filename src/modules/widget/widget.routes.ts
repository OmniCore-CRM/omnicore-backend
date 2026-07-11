import { Router, type Request } from "express";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { WidgetController } from "./widget.controller.js";
import {
  createWidgetConversationSchema,
  createWidgetArticleCategorySchema,
  createWidgetArticleSchema,
  createWidgetInstallationSchema,
  createWidgetMessageSchema,
  updateWidgetInstallationSchema,
  createWidgetFaqEntrySchema,
  updateWidgetFaqEntrySchema,
  updateWidgetArticleCategorySchema,
  updateWidgetArticleSchema,
  updateWidgetArticleStatusSchema,
  widgetPublicAskSchema,
  widgetSupportAskBodySchema,
} from "./widget.validation.js";
import { rateLimit } from "@/core/middleware/rate-limit.middleware.js";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { AttachmentController } from "@/modules/attachments/attachment.controller.js";
import { uploadSingleAttachment } from "@/modules/attachments/attachment.upload.js";
import { uploadBrandingImage } from "./widget.branding-upload.js";

const router = Router();

const getClientIp = (req: Request) =>
  req.ip || req.socket.remoteAddress || "unknown";

const publicWidgetKey = (req: Request) =>
  String(req.body?.publicKey || req.query?.key || "unknown-key");

const publicSupportSlug = (req: Request) =>
  String(req.params.companySlug || "unknown-slug");

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

const widgetSupportReadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: "widget:support:read",
  keyGenerator: (req) => [
    `ip:${getClientIp(req)}`,
    `slug:${publicSupportSlug(req)}`,
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

router.get(
  "/help-center",
  widgetReadRateLimit,
  WidgetController.getPublicHelpCenter
);

router.get(
  "/help-center/articles/:slug",
  widgetReadRateLimit,
  WidgetController.getPublicHelpCenterArticle
);

router.post(
  "/help-center/ask",
  widgetReadRateLimit,
  validateRequest(widgetPublicAskSchema),
  WidgetController.askPublicHelpCenter
);

router.get(
  "/support/:companySlug/bootstrap",
  widgetSupportReadRateLimit,
  WidgetController.bootstrapSupportPortal
);

router.get(
  "/support/:companySlug/help-center",
  widgetSupportReadRateLimit,
  WidgetController.getSupportHelpCenter
);

router.get(
  "/support/:companySlug/help-center/articles/:articleSlug",
  widgetSupportReadRateLimit,
  WidgetController.getSupportHelpCenterArticle
);

router.post(
  "/support/:companySlug/help-center/ask",
  widgetSupportReadRateLimit,
  validateRequest(widgetSupportAskBodySchema),
  WidgetController.askSupportHelpCenter
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

// ===== Knowledge base management (admin) =====
router.get(
  "/installations/:id/categories",
  protect,
  authorize(...RBAC.knowledgeBase),
  WidgetController.listArticleCategories
);

router.post(
  "/installations/:id/categories",
  protect,
  authorize(...RBAC.knowledgeBase),
  validateRequest(createWidgetArticleCategorySchema),
  WidgetController.createArticleCategory
);

router.patch(
  "/installations/:id/categories/:categoryId",
  protect,
  authorize(...RBAC.knowledgeBase),
  validateRequest(updateWidgetArticleCategorySchema),
  WidgetController.updateArticleCategory
);

router.delete(
  "/installations/:id/categories/:categoryId",
  protect,
  authorize(...RBAC.knowledgeBase),
  WidgetController.deleteArticleCategory
);

router.get(
  "/installations/:id/articles",
  protect,
  authorize(...RBAC.knowledgeBase),
  WidgetController.listArticles
);

router.get(
  "/installations/:id/articles/:articleId",
  protect,
  authorize(...RBAC.knowledgeBase),
  WidgetController.getArticle
);

router.post(
  "/installations/:id/articles",
  protect,
  authorize(...RBAC.knowledgeBase),
  validateRequest(createWidgetArticleSchema),
  WidgetController.createArticle
);

router.patch(
  "/installations/:id/articles/:articleId",
  protect,
  authorize(...RBAC.knowledgeBase),
  validateRequest(updateWidgetArticleSchema),
  WidgetController.updateArticle
);

router.patch(
  "/installations/:id/articles/:articleId/status",
  protect,
  authorize(...RBAC.knowledgeBase),
  validateRequest(updateWidgetArticleStatusSchema),
  WidgetController.updateArticleStatus
);

// ===== Branding uploads (admin) =====

// Public: serve branding images without auth (logo/hero on public widget page)
router.get("/branding/:key", WidgetController.serveBrandingImage);

router.post(
  "/installations/:id/logo",
  protect,
  authorize(...RBAC.admin),
  uploadBrandingImage,
  WidgetController.uploadLogo
);

router.delete(
  "/installations/:id/logo",
  protect,
  authorize(...RBAC.admin),
  WidgetController.removeLogo
);

router.post(
  "/installations/:id/hero",
  protect,
  authorize(...RBAC.admin),
  uploadBrandingImage,
  WidgetController.uploadHero
);

router.delete(
  "/installations/:id/hero",
  protect,
  authorize(...RBAC.admin),
  WidgetController.removeHero
);

export default router;
