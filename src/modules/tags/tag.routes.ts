import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { authorize, RBAC } from "@/core/middleware/authorize.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { TagController } from "./tag.controller.js";
import { createTagSchema, updateTagSchema } from "./tag.validation.js";

const router = Router();

router.get("/", protect, TagController.getTags);

router.post(
  "/",
  protect,
  authorize(...RBAC.adminAndLead),
  validateRequest(createTagSchema),
  TagController.createTag
);

router.patch(
  "/:id",
  protect,
  authorize(...RBAC.adminAndLead),
  validateRequest(updateTagSchema),
  TagController.updateTag
);

router.delete("/:id", protect, authorize(...RBAC.adminAndLead), TagController.deleteTag);

export default router;
