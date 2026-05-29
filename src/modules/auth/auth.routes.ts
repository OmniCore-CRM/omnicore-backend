import { Router } from "express";
import { AuthController } from "./auth.controller.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { registerSchema, loginSchema } from "./auth.validation.js";
import authTestRoutes from "./auth.test.routes.js";
import { protect } from "@/core/middleware/auth.middleware.js";
import { rateLimit } from "@/core/middleware/rate-limit.middleware.js";

const router = Router();

// Auth routes
router.post(
  "/register",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    keyPrefix: "auth:register",
  }),
  validateRequest(registerSchema),
  AuthController.register
);

router.post(
  "/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    keyPrefix: "auth:login",
  }),
  validateRequest(loginSchema),
  AuthController.login
);

// Authenticated session route
router.get(
  "/me",
  protect,
  AuthController.me
);

router.use(authTestRoutes);

export default router;
