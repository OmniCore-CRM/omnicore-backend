import {
  AIProvider,
  AIReplyContext,
  AIReplyResponse,
} from "./ai-provider.js";

/**
 * OpenRouterAIProvider
 *
 * Uses the OpenAI-compatible endpoint at https://openrouter.ai/api/v1/chat/completions.
 * Defaults to the `openrouter/auto` free tier model.
 *
 * Cost tracking is best-effort: OpenRouter exposes usage in the same shape as
 * the OpenAI API so we read it when available, but the free tier often returns
 * zeroes.  costMicroUSD is stored as 0 in those cases — the audit record is
 * still written so operators can see suggestions were made.
 */
export class OpenRouterAIProvider implements AIProvider {
  name = "openrouter";
  maxContextTokens = 4000;
  costPerMillionInputTokens = 0; // Free tier — updated per model if needed
  costPerMillionOutputTokens = 0;

  private apiKey: string;
  private baseUrl = "https://openrouter.ai/api/v1";
  private model: string;

  constructor(model = "openrouter/auto") {
    this.apiKey = process.env.OPENROUTER_API_KEY || "";
    if (!this.apiKey) {
      throw new Error("OPENROUTER_API_KEY not configured");
    }
    this.model = model;
  }

  validateInput(context: AIReplyContext): { valid: boolean; reason?: string } {
    if (!context.companyId || !context.conversationId) {
      return { valid: false, reason: "Missing company or conversation ID" };
    }
    if (context.lastMessages.length === 0) {
      return { valid: false, reason: "No conversation history" };
    }
    if (context.lastMessages.length > 5) {
      context.lastMessages = context.lastMessages.slice(-5);
    }
    return { valid: true };
  }

  async generateReplySuggestion(
    context: AIReplyContext
  ): Promise<AIReplyResponse> {
    const validation = this.validateInput(context);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    const prompt = this.buildPrompt(context);
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": "https://omnicore.app",
          "X-Title": "OmniCore CRM",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "system",
              content: "You are a helpful customer support agent assistant.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 256,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenRouter API error: ${response.status} - ${errorText}`
        );
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const suggestion = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!suggestion) {
        throw new Error("OpenRouter returned an empty suggestion");
      }

      const usage = data.usage ?? {};
      const responseTimeMs = Date.now() - startTime;
      const costMicroUSD = this.calculateCost(
        usage.prompt_tokens ?? 0,
        usage.completion_tokens ?? 0
      );

      return {
        suggestion,
        confidence: 75,
        costMicroUSD,
        tokensUsed: (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
        providerResponseTimeMs: responseTimeMs,
      };
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      throw new Error(
        `Failed to generate suggestion: ${
          error instanceof Error ? error.message : "Unknown error"
        } (${responseTimeMs}ms)`
      );
    }
  }

  private buildPrompt(context: AIReplyContext): string {
    const messagesText = context.lastMessages
      .map((m) => `[${m.sender}]: ${m.content}`)
      .join("\n");

    return `You are a helpful support agent assistant. Suggest a reply to the customer based on context.

## Context
- Customer: ${context.customerFirstName ?? "Customer"}
- Channel: ${context.channel}
- Status: ${context.conversationStatus}

## Recent Conversation
${messagesText}

## Instructions
- Keep reply professional and empathetic
- Match the tone of previous responses
- Stay within 2-3 sentences
- Do not include customer personal data, links, or account numbers
- If you cannot suggest safely, respond: "Unable to suggest a reply for this context."

Suggest a reply:`;
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCost =
      (inputTokens / 1_000_000) * this.costPerMillionInputTokens;
    const outputCost =
      (outputTokens / 1_000_000) * this.costPerMillionOutputTokens;
    return Math.round((inputCost + outputCost) * 1_000_000);
  }
}
