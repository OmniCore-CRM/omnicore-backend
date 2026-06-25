import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { SlaPolicyController } from "./sla-policy.controller.js";
import {
  createSlaPolicySchema,
  updateSlaPolicySchema,
} from "./sla-policy.validation.js";

const router = Router();

router.get("/", protect, authorize(...RBAC.admin), SlaPolicyController.list);
router.post(
  "/",
  protect,
  authorize(...RBAC.admin),
  validateRequest(createSlaPolicySchema),
  SlaPolicyController.create
);
router.patch(
  "/:id",
  protect,
  authorize(...RBAC.admin),
  validateRequest(updateSlaPolicySchema),
  SlaPolicyController.update
);
router.delete("/:id", protect, authorize(...RBAC.admin), SlaPolicyController.delete);

export default router;
