import { Router } from "express";
import { ChannelController } from "./channel.controller.js";
import { rateLimit } from "@/core/middleware/rate-limit.middleware.js";
import emailRoutes from "@/modules/email/email.routes.js";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";

const router = Router();
router.use("/email", emailRoutes);

const webhookRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: "channels:webhook",
});

// ===== Webhook verification =====
router.get(
  "/webhook",
  webhookRateLimit,
  ChannelController.verifyWebhook
);

// ===== Receive webhook events =====
router.post(
  "/webhook",
  webhookRateLimit,
  ChannelController.receiveWebhook
);

router.post(
  "/reconcile",
  protect,
  authorize(...RBAC.admin),
  ChannelController.reconcileReliability
);

router.get(
  "/operations/overview",
  protect,
  authorize(...RBAC.admin),
  ChannelController.operationsOverview
);

export default router;
