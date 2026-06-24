import { Router } from "express";
import { env } from "@/config/env.js";
import { protect } from "@/core/middleware/auth.middleware.js";
import type { AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { authorize } from "@/core/middleware/authorize.middleware.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";

const router = Router();

if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
  router.get("/me", protect, (req: AuthenticatedRequest, res) => {
    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: "Authenticated user retrieved successfully",
      user: req.user,
    });
  });

  router.get("/owner-only", protect, authorize("OWNER"), (_req, res) => {
    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: "OWNER access granted",
    });
  });
}

export default router;
