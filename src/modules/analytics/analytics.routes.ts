import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { AnalyticsController } from "./analytics.controller.js";

const router = Router();

router.get("/overview", protect, AnalyticsController.overview);

export default router;
