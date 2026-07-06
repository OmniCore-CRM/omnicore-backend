import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { AssignmentCenterController } from "./assignment-center.controller.js";

const router = Router();

router.get("/", protect, AssignmentCenterController.overview);

export default router;
