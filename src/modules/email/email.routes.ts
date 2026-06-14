import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { rateLimit } from "@/core/middleware/rate-limit.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { EmailController } from "./email.controller.js";
import {
  createEmailAccountSchema,
  updateEmailAccountSchema,
} from "./email.validation.js";

const router = Router();
const webhookRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: "channels:email:webhook",
});

router.get("/accounts", protect, EmailController.listAccounts);
router.post(
  "/accounts",
  protect,
  validateRequest(createEmailAccountSchema),
  EmailController.createAccount
);
router.patch(
  "/accounts/:id",
  protect,
  validateRequest(updateEmailAccountSchema),
  EmailController.updateAccount
);
router.delete("/accounts/:id", protect, EmailController.deleteAccount);
router.post("/webhook", webhookRateLimit, EmailController.receiveWebhook);

export default router;
