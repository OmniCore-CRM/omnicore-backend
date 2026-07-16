import {
  AIProvider,
  AIReplyContext,
  AIReplyResponse,
} from "./ai-provider.js";

export class DeepSeekAIProvider implements AIProvider {
  name = "deepseek_v3";
  maxContextTokens = 4000;
  costPerMillionInputTokens = 0.27; // $0.27 per 1M input tokens
  costPerMillionOutputTokens = 1.1; // $1.10 per 1M output tokens

  private apiKey: string;
  private baseUrl: string = "https://api.deepseek.com/v1";

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || "";
    if (!this.apiKey) {
      throw new Error("DEEPSEEK_API_KEY not configured");
    }
  }

  validateInput(context: AIReplyContext) {
    if (!context.companyId || !context.conversationId) {
      return { valid: false, reason: "Missing company or conversation ID" };
    }
    if (context.lastMessages.length === 0) {
      return { valid: false, reason: "No conversation history" };
    }
    if (context.lastMessages.length > 5) {
      // Limit to last 5 messages
      context.lastMessages = context.lastMessages.slice(-5);
    }
    return { valid: true };
  }

  async generateReplySuggestion(context: AIReplyContext): Promise<AIReplyResponse> {
    const validation = this.validateInput(context);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    const prompt = this.buildPrompt(context);
    const startTime = Date.now();

    try {
      // Call DeepSeek API
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: "You are a helpful support agent assistant." },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 256,
          top_p: 0.95,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
      }

      const data = (await response.json()) as any;
      const suggestion = data.choices?.[0]?.message?.content || "";
      const usage = data.usage || {};

      const responseTimeMs = Date.now() - startTime;
      const costMicroUSD = this.calculateCost(
        usage.prompt_tokens || 0,
        usage.completion_tokens || 0
      );

      return {
        suggestion,
        confidence: 75, // Provisional; can refine based on suggestion quality
        costMicroUSD,
        tokensUsed: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
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

    return `
You are a helpful support agent assistant. Suggest a reply to the customer based on context.

## Context
- Customer: ${context.customerFirstName || "Customer"}
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
    const inputCost = (inputTokens / 1_000_000) * this.costPerMillionInputTokens;
    const outputCost = (outputTokens / 1_000_000) * this.costPerMillionOutputTokens;
    return Math.round((inputCost + outputCost) * 1_000_000); // Convert to microUSD
  }
}
