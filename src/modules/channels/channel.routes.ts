import { Router } from "express";
import { ChannelController } from "./channel.controller.js";
import { rateLimit } from "@/core/middleware/rate-limit.middleware.js";

const router = Router();

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

export default router;
