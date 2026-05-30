import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { UserController } from "./user.controller.js";

const router = Router();

router.get("/", protect, UserController.getCompanyUsers);

export default router;
