import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { validateRequest } from "@/core/middleware/validate.middleware.js";
import { MessageController } from "./message.controller.js";
import { createMessageSchema } from "./message.validation.js";
import { AttachmentController } from "@/modules/attachments/attachment.controller.js";
import { uploadSingleAttachment } from "@/modules/attachments/attachment.upload.js";

const router = Router();

// Create tenant-scoped message
router.post(
  "/",
  protect,
  validateRequest(createMessageSchema),
  MessageController.createMessage
);

router.post(
  "/:messageId/attachments",
  protect,
  uploadSingleAttachment,
  AttachmentController.upload
);

export default router;
