import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { AssignmentRuleController } from "./assignment-rule.controller.js";
import {
  createAssignmentRuleSchema,
  updateAssignmentRuleSchema,
} from "./assignment-rule.validation.js";

const router = Router();

router.get("/", protect, AssignmentRuleController.list);
router.post(
  "/",
  protect,
  validateRequest(createAssignmentRuleSchema),
  AssignmentRuleController.create
);
router.patch(
  "/:id",
  protect,
  validateRequest(updateAssignmentRuleSchema),
  AssignmentRuleController.update
);
router.delete("/:id", protect, AssignmentRuleController.delete);

export default router;
