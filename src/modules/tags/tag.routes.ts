import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { TagController } from "./tag.controller.js";
import { createTagSchema, updateTagSchema } from "./tag.validation.js";

const router = Router();

router.get("/", protect, TagController.getTags);

router.post(
  "/",
  protect,
  validateRequest(createTagSchema),
  TagController.createTag
);

router.patch(
  "/:id",
  protect,
  validateRequest(updateTagSchema),
  TagController.updateTag
);

router.delete("/:id", protect, TagController.deleteTag);

export default router;
