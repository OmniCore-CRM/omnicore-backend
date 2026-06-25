import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { AssignmentRuleController } from "./assignment-rule.controller.js";
import {
  createAssignmentRuleSchema,
  updateAssignmentRuleSchema,
} from "./assignment-rule.validation.js";

const router = Router();

router.get("/", protect, authorize(...RBAC.admin), AssignmentRuleController.list);
router.post(
  "/",
  protect,
  authorize(...RBAC.admin),
  validateRequest(createAssignmentRuleSchema),
  AssignmentRuleController.create
);
router.patch(
  "/:id",
  protect,
  authorize(...RBAC.admin),
  validateRequest(updateAssignmentRuleSchema),
  AssignmentRuleController.update
);
router.delete("/:id", protect, authorize(...RBAC.admin), AssignmentRuleController.delete);

export default router;
