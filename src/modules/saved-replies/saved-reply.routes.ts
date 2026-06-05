import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { SavedReplyController } from "./saved-reply.controller.js";
import {
  createSavedReplySchema,
  updateSavedReplySchema,
} from "./saved-reply.validation.js";

const router = Router();

router.get("/", protect, SavedReplyController.getSavedReplies);

router.post(
  "/",
  protect,
  validateRequest(createSavedReplySchema),
  SavedReplyController.createSavedReply
);

router.patch(
  "/:id",
  protect,
  validateRequest(updateSavedReplySchema),
  SavedReplyController.updateSavedReply
);

router.delete("/:id", protect, SavedReplyController.deleteSavedReply);

export default router;
