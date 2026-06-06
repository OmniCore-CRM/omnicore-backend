import { Router } from "express";
import authRoutes from "@/modules/auth/auth.routes.js";
import customerRoutes from "@/modules/customers/customer.routes.js";
import conversationRoutes from "@/modules/conversations/conversation.routes.js";
import messageRoutes from "@/modules/messages/message.routes.js";
import widgetRoutes from "@/modules/widget/widget.routes.js";
import channelRoutes from "@/modules/channels/channel.routes.js";
import ticketRoutes from "@/modules/tickets/ticket.routes.js";
import userRoutes from "@/modules/users/user.routes.js";
import savedReplyRoutes from "@/modules/saved-replies/saved-reply.routes.js";
import tagRoutes from "@/modules/tags/tag.routes.js";

const router = Router();

// API module routes
router.use("/auth", authRoutes);

// Customer routes
router.use("/customers", customerRoutes);

// User routes
router.use("/users", userRoutes);

// Conversation routes
router.use("/conversations", conversationRoutes);

// Message routes
router.use("/messages", messageRoutes);

// Ticket routes
router.use("/tickets", ticketRoutes);

// Saved reply routes
router.use("/saved-replies", savedReplyRoutes);

// Tag routes
router.use("/tags", tagRoutes);

// Widget routes
router.use("/widget", widgetRoutes);

// Channel routes
router.use("/channels", channelRoutes);

export default router;
