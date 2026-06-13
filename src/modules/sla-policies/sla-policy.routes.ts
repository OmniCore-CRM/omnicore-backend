import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { SlaPolicyController } from "./sla-policy.controller.js";
import {
  createSlaPolicySchema,
  updateSlaPolicySchema,
} from "./sla-policy.validation.js";

const router = Router();

router.get("/", protect, SlaPolicyController.list);
router.post(
  "/",
  protect,
  validateRequest(createSlaPolicySchema),
  SlaPolicyController.create
);
router.patch(
  "/:id",
  protect,
  validateRequest(updateSlaPolicySchema),
  SlaPolicyController.update
);
router.delete("/:id", protect, SlaPolicyController.delete);

export default router;
