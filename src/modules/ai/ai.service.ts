import { prisma } from "@/config/db.js";
import { AIProvider, AIReplyContext } from "@/core/ai-provider.js";
import { DeepSeekAIProvider } from "@/core/deepseek-provider.js";
import type { AccessTokenPayload } from "../auth/auth.utils.js";

export interface AIInteractionDTO {
  id: string;
  suggestion: string;
  confidence: number;
}

export class AIService {
  private provider: AIProvider | null = null;
  private initError: Error | null = null;

  constructor(provider?: AIProvider) {
    this.provider = provider || null;
  }

  private ensureProvider(): AIProvider {
    if (this.provider) {
      return this.provider;
    }

    if (this.initError) {
      throw this.initError;
    }

    try {
      this.provider = new DeepSeekAIProvider();
      return this.provider;
    } catch (error) {
      this.initError = error instanceof Error ? error : new Error(String(error));
      throw this.initError;
    }
  }

  async suggestReply(
    user: AccessTokenPayload,
    conversationId: string
  ): Promise<AIInteractionDTO> {
    try {
      // Verify conversation exists and user has access
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          companyId: user.companyId,
        },
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 10,
          },
          customer: true,
        },
      });

      if (!conversation) {
        throw new Error("Conversation not found");
      }

      // Check rate limits
      const recentInteractions = await prisma.aIInteraction.count({
        where: {
          companyId: user.companyId,
          userId: user.userId,
          createdAt: {
            gte: new Date(Date.now() - 60 * 60 * 1000), // Last hour
          },
        },
      });

      if (recentInteractions > 100) {
        throw new Error("Rate limit exceeded: 100 suggestions per hour");
      }

      // Prepare redacted context
      const context: AIReplyContext = {
        companyId: user.companyId,
        conversationId,
        customerFirstName: conversation.customer?.firstName,
        channel: conversation.channel,
        lastMessages: conversation.messages
          .slice(0, 5)
          .reverse()
          .map((m) => ({
            sender: m.sender,
            content: m.content.substring(0, 500), // Limit message length
            timestamp: m.createdAt,
          })),
        conversationStatus: conversation.status,
      };

      // Generate suggestion (provider is lazily initialized here)
      const aiResponse = await this.ensureProvider().generateReplySuggestion(
        context
      );

      // Store interaction for audit
      const interaction = await prisma.aIInteraction.create({
        data: {
          companyId: user.companyId,
          conversationId,
          userId: user.userId,
          requestType: "REPLY_SUGGESTION",
          inputContext: context as unknown as any,
          generatedSuggestion: aiResponse.suggestion,
          confidence: aiResponse.confidence,
          costMicroUSD: aiResponse.costMicroUSD,
          provider: this.ensureProvider().name,
          tokensUsed: aiResponse.tokensUsed,
          responseTimeMs: aiResponse.providerResponseTimeMs,
        },
      });

      return {
        id: interaction.id,
        suggestion: interaction.generatedSuggestion,
        confidence: Number(interaction.confidence),
      };
    } catch (error) {
      // Wrap configuration errors with helpful message
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("DEEPSEEK_API_KEY")) {
        throw new Error(
          "AI suggestions are not configured. Please contact your administrator."
        );
      }
      throw error;
    }
  }

  async acceptSuggestion(
    user: AccessTokenPayload,
    interactionId: string,
    messageId?: string
  ): Promise<void> {
    // Verify ownership - must be creator AND same company
    const interaction = await prisma.aIInteraction.findFirst({
      where: {
        id: interactionId,
        companyId: user.companyId,
        userId: user.userId, // Strict user ownership check
      },
    });

    if (!interaction) {
      throw new Error("AI suggestion not found or access denied");
    }

    await prisma.aIInteraction.update({
      where: { id: interactionId },
      data: {
        userAction: "ACCEPTED",
        acceptedAt: new Date(),
        sentAsMessageId: messageId,
      },
    });
  }

  async rejectSuggestion(
    user: AccessTokenPayload,
    interactionId: string
  ): Promise<void> {
    // Verify ownership - must be creator AND same company
    const interaction = await prisma.aIInteraction.findFirst({
      where: {
        id: interactionId,
        companyId: user.companyId,
        userId: user.userId, // Strict user ownership check
      },
    });

    if (!interaction) {
      throw new Error("AI suggestion not found or access denied");
    }

    await prisma.aIInteraction.update({
      where: { id: interactionId },
      data: { userAction: "REJECTED" },
    });
  }
}

let aiServiceInstance: AIService | null = null;

export function getAIService(): AIService {
  if (!aiServiceInstance) {
    aiServiceInstance = new AIService();
  }
  return aiServiceInstance;
}
