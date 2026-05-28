import { Router } from "express";
import { ChannelController } from "./channel.controller.js";

const router = Router();

// ===== Webhook verification =====
router.get(
  "/webhook",
  ChannelController.verifyWebhook
);

// ===== Receive webhook events =====
router.post(
  "/webhook",
  ChannelController.receiveWebhook
);

export default router;