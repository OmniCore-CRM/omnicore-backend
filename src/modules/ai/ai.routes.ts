import { Router } from "express";
import { protect, AuthenticatedRequest } from "@/core/middleware/auth.middleware.js";
import { getAIService } from "./ai.service.js";

export const aiRouter = Router();

// All AI routes require authentication
aiRouter.use(protect);

// POST /api/v1/ai/reply-suggestions
aiRouter.post(
  "/reply-suggestions",
  (req: AuthenticatedRequest, res) => {
    void (async () => {
      try {
        const user = req.user;

        if (!user) {
          res.status(401).json({
            success: false,
            message: "Unauthorized",
          });
          return;
        }

        const { conversationId } = req.body;

        if (!conversationId) {
          res.status(400).json({
            success: false,
            message: "Conversation ID is required",
          });
          return;
        }

        const suggestion = await getAIService().suggestReply(user, conversationId);

        res.json({
          success: true,
          data: suggestion,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to generate suggestion";

        res.status(400).json({
          success: false,
          message,
        });
      }
    })();
  }
);

// POST /api/v1/ai/reply-suggestions/:id/accept
aiRouter.post(
  "/reply-suggestions/:id/accept",
  (req: AuthenticatedRequest, res) => {
    void (async () => {
      try {
        const user = req.user;

        if (!user) {
          res.status(401).json({
            success: false,
            message: "Unauthorized",
          });
          return;
        }

        const id = typeof req.params.id === "string" ? req.params.id : "";
        const { messageId } = req.body;

        await getAIService().acceptSuggestion(user, id, messageId);

        res.json({ success: true });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to accept suggestion";

        res.status(400).json({
          success: false,
          message,
        });
      }
    })();
  }
);

// POST /api/v1/ai/reply-suggestions/:id/reject
aiRouter.post(
  "/reply-suggestions/:id/reject",
  (req: AuthenticatedRequest, res) => {
    void (async () => {
      try {
        const user = req.user;

        if (!user) {
          res.status(401).json({
            success: false,
            message: "Unauthorized",
          });
          return;
        }

        const id = typeof req.params.id === "string" ? req.params.id : "";

        await getAIService().rejectSuggestion(user, id);

        res.json({ success: true });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to reject suggestion";

        res.status(400).json({
          success: false,
          message,
        });
      }
    })();
  }
);
