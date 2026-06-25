import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
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

router.get("/accounts", protect, authorize(...RBAC.admin), EmailController.listAccounts);
router.post(
  "/accounts",
  protect,
  authorize(...RBAC.admin),
  validateRequest(createEmailAccountSchema),
  EmailController.createAccount
);
router.patch(
  "/accounts/:id",
  protect,
  authorize(...RBAC.admin),
  validateRequest(updateEmailAccountSchema),
  EmailController.updateAccount
);
router.delete("/accounts/:id", protect, authorize(...RBAC.admin), EmailController.deleteAccount);
router.post("/webhook", webhookRateLimit, EmailController.receiveWebhook);

export default router;
