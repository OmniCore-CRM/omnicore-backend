CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'SNOOZED');

CREATE TYPE "ConversationActivityAction" AS ENUM ('STATUS_CHANGED');

ALTER TABLE "Conversation"
ADD COLUMN "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN';

CREATE TABLE "ConversationActivity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "ConversationActivityAction" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Conversation_status_idx" ON "Conversation"("status");
CREATE INDEX "ConversationActivity_companyId_idx" ON "ConversationActivity"("companyId");
CREATE INDEX "ConversationActivity_conversationId_idx" ON "ConversationActivity"("conversationId");
CREATE INDEX "ConversationActivity_actorId_idx" ON "ConversationActivity"("actorId");
CREATE INDEX "ConversationActivity_action_idx" ON "ConversationActivity"("action");

ALTER TABLE "ConversationActivity" ADD CONSTRAINT "ConversationActivity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationActivity" ADD CONSTRAINT "ConversationActivity_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationActivity" ADD CONSTRAINT "ConversationActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
