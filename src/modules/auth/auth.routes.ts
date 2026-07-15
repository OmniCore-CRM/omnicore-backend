import { Router } from "express";
import { AuthController } from "./auth.controller.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  acceptInviteSchema,
  updateProfileSchema,
} from "./auth.validation.js";
import { protect } from "@/core/middleware/auth.middleware.js";
import { rateLimit } from "@/core/middleware/rate-limit.middleware.js";

const router = Router();

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

router.post(
  "/forgot-password",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    keyPrefix: "auth:forgot-password",
  }),
  validateRequest(forgotPasswordSchema),
  AuthController.forgotPassword
);

router.post(
  "/reset-password",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    keyPrefix: "auth:reset-password",
  }),
  validateRequest(resetPasswordSchema),
  AuthController.resetPassword
);

router.get(
  "/invite/validate",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    keyPrefix: "auth:invite:validate",
  }),
  AuthController.validateInvite,
);

router.post(
  "/invite/accept",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 25,
    keyPrefix: "auth:invite:accept",
  }),
  validateRequest(acceptInviteSchema),
  AuthController.acceptInvite,
);

router.post(
  "/refresh",
  rateLimit({
    // Refresh uses HttpOnly cookie rotation and may burst during hard reloads
    // across multiple protected routes/tabs. Keep guardrails, but avoid
    // throttling valid sessions into false logout paths.
    windowMs: 5 * 60 * 1000,
    max: 600,
    keyPrefix: "auth:refresh",
  }),
  AuthController.refresh
);

router.post("/logout", AuthController.logout);

router.get("/me", protect, AuthController.me);

router.patch(
  "/me",
  protect,
  validateRequest(updateProfileSchema),
  AuthController.updateMe,
);

export default router;
