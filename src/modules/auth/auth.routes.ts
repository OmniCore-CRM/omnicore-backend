import { Router } from "express";
import { AuthController } from "./auth.controller.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { registerSchema, loginSchema } from "./auth.validation.js";
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
  "/refresh",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    keyPrefix: "auth:refresh",
  }),
  AuthController.refresh
);

router.post("/logout", AuthController.logout);

router.get("/me", protect, AuthController.me);

export default router;
