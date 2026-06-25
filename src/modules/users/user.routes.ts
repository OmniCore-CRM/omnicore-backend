import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { UserController } from "./user.controller.js";

const router = Router();

router.get("/", protect, authorize(...RBAC.operational), UserController.getCompanyUsers);

export default router;
