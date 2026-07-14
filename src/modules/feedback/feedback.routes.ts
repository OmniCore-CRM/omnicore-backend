import { Router, type Request } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { rateLimit } from "@/core/middleware/rate-limit.middleware.js";
import { FeedbackController } from "./feedback.controller.js";
import {
  submitFeedbackResponseSchema,
  updateFeedbackTriggerConfigSchema,
} from "./feedback.validation.js";

const router = Router();

const getClientIp = (req: Request) => req.ip || req.socket.remoteAddress || "unknown";

const publicTokenKey = (req: Request) => String(req.params.token || "unknown-token");

const feedbackPublicReadRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyPrefix: "feedback:public:read",
  keyGenerator: (req) => [`ip:${getClientIp(req)}`, `token:${publicTokenKey(req)}`],
});

const feedbackPublicSubmitRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  keyPrefix: "feedback:public:submit",
  keyGenerator: (req) => [`ip:${getClientIp(req)}`, `token:${publicTokenKey(req)}`],
});

router.get(
  "/overview",
  protect,
  authorize(...RBAC.readOnly),
  FeedbackController.getOverview
);

router.get(
  "/detractors",
  protect,
  authorize(...RBAC.readOnly),
  FeedbackController.getDetractors
);

router.get(
  "/trigger-config",
  protect,
  authorize(...RBAC.adminAndLead),
  FeedbackController.getTriggerConfigs
);

router.put(
  "/trigger-config",
  protect,
  authorize(...RBAC.adminAndLead),
  validateRequest(updateFeedbackTriggerConfigSchema),
  FeedbackController.updateTriggerConfig
);

router.patch(
  "/escalations/:id",
  protect,
  authorize(...RBAC.operational),
  FeedbackController.updateEscalation
);

router.get(
  "/public/:token",
  feedbackPublicReadRateLimit,
  FeedbackController.getPublicSurvey
);

router.post(
  "/public/:token",
  feedbackPublicSubmitRateLimit,
  validateRequest(submitFeedbackResponseSchema),
  FeedbackController.submitPublicSurvey
);

export default router;
