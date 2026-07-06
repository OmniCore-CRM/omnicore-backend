-- Phase 4: add direct assignee support for conversations
ALTER TABLE "Conversation"
ADD COLUMN "assigneeId" TEXT;

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_assigneeId_fkey"
FOREIGN KEY ("assigneeId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "Conversation_assigneeId_idx" ON "Conversation"("assigneeId");

CREATE INDEX "Conversation_companyId_assigneeId_updatedAt_id_idx"
ON "Conversation"("companyId", "assigneeId", "updatedAt", "id");
