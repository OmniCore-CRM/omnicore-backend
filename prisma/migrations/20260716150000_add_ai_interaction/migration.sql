-- CreateEnum
CREATE TYPE "AIInteractionRequestType" AS ENUM ('REPLY_SUGGESTION', 'SUMMARY', 'ROUTING_SUGGESTION', 'ESCALATION_RECOMMENDATION');

-- CreateEnum
CREATE TYPE "AIInteractionUserAction" AS ENUM ('ACCEPTED', 'EDITED', 'REJECTED');

-- CreateTable
CREATE TABLE "AIInteraction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestType" "AIInteractionRequestType" NOT NULL,
    "inputContext" JSONB NOT NULL,
    "generatedSuggestion" TEXT NOT NULL,
    "confidence" NUMERIC(5,2) NOT NULL,
    "costMicroUSD" INTEGER,
    "userAction" "AIInteractionUserAction",
    "acceptedAt" TIMESTAMP(3),
    "editedContent" TEXT,
    "sentAsMessageId" TEXT,
    "provider" TEXT NOT NULL,
    "modelId" TEXT,
    "tokensUsed" INTEGER,
    "responseTimeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIInteraction_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AIInteraction" ADD CONSTRAINT "AIInteraction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInteraction" ADD CONSTRAINT "AIInteraction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInteraction" ADD CONSTRAINT "AIInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInteraction" ADD CONSTRAINT "AIInteraction_sentAsMessageId_fkey" FOREIGN KEY ("sentAsMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AIInteraction_companyId_idx" ON "AIInteraction"("companyId");

-- CreateIndex
CREATE INDEX "AIInteraction_conversationId_idx" ON "AIInteraction"("conversationId");

-- CreateIndex
CREATE INDEX "AIInteraction_companyId_createdAt_idx" ON "AIInteraction"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AIInteraction_companyId_userId_createdAt_idx" ON "AIInteraction"("companyId", "userId", "createdAt");

-- CreateUnique
CREATE UNIQUE INDEX "AIInteraction_sentAsMessageId_key" ON "AIInteraction"("sentAsMessageId");
