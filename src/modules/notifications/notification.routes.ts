import { Router } from "express";
import { protect } from "@/core/middleware/auth.middleware.js";
import { NotificationController } from "./notification.controller.js";

const router = Router();

router.get("/", protect, NotificationController.list);
router.get("/unread-count", protect, NotificationController.unreadCount);
router.patch("/:id/read", protect, NotificationController.markRead);
router.patch("/:id/unread", protect, NotificationController.markUnread);
router.patch("/read-all", protect, NotificationController.markAllRead);

export default router;
