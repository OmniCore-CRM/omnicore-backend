import { Router } from "express";
import authRoutes from "@/modules/auth/auth.routes.js";
import customerRoutes from "@/modules/customers/customer.routes.js";
import conversationRoutes from "@/modules/conversations/conversation.routes.js";
import messageRoutes from "@/modules/messages/message.routes.js";
import widgetRoutes from "@/modules/widget/widget.routes.js";
import channelRoutes from "@/modules/channels/channel.routes.js";
import ticketRoutes from "@/modules/tickets/ticket.routes.js";

const router = Router();

// API module routes
router.use("/auth", authRoutes);

// Customer routes
router.use("/customers", customerRoutes);

// Conversation routes
router.use("/conversations", conversationRoutes);

// Message routes
router.use("/messages", messageRoutes);

// Ticket routes
router.use("/tickets", ticketRoutes);

// Widget routes
router.use("/widget", widgetRoutes);

// Channel routes
router.use("/channels", channelRoutes);

export default router;
