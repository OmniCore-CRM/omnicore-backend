import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { AnalyticsController } from "./analytics.controller.js";

const router = Router();

router.get(
	"/overview",
	protect,
	authorize(...RBAC.readOnly),
	AnalyticsController.overview
);

export default router;
