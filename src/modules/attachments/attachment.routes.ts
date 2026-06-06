import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import {
  AttachmentController,
  optionalProtect,
} from "./attachment.controller.js";
import { uploadSingleAttachment } from "./attachment.upload.js";

const router = Router();

router.post(
  "/upload",
  protect,
  uploadSingleAttachment,
  AttachmentController.upload
);

router.get("/:id", optionalProtect, AttachmentController.download);

export default router;
