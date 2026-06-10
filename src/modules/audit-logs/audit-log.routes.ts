import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { AuditLogController } from "./audit-log.controller.js";

const router = Router();

router.get("/", protect, AuditLogController.list);

export default router;
