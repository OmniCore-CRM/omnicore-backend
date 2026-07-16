import { ConversationChannel, ConversationStatus, MessageSender } from "@prisma/client";

export interface AIReplyContext {
  companyId: string;
  conversationId: string;
  customerFirstName?: string;
  channel: ConversationChannel;
  lastMessages: Array<{
    sender: MessageSender;
    content: string;
    timestamp: Date;
  }>;
  conversationStatus: ConversationStatus;
  issueCategory?: string;
}

export interface AIReplyResponse {
  suggestion: string;
  confidence: number; // 0-100
  costMicroUSD: number;
  tokensUsed: number;
  providerResponseTimeMs: number;
}

export interface AIProvider {
  name: string;
  maxContextTokens: number;
  costPerMillionInputTokens: number;
  costPerMillionOutputTokens: number;

  generateReplySuggestion(context: AIReplyContext): Promise<AIReplyResponse>;
  validateInput(
    context: AIReplyContext
  ): { valid: boolean; reason?: string };
}
