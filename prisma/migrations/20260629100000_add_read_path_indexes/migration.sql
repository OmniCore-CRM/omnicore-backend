-- Improve read performance for conversation/ticket/message list endpoints.

CREATE INDEX "Conversation_companyId_updatedAt_id_idx"
ON "Conversation"("companyId", "updatedAt", "id");

CREATE INDEX "Conversation_companyId_status_updatedAt_id_idx"
ON "Conversation"("companyId", "status", "updatedAt", "id");

CREATE INDEX "Conversation_companyId_teamId_updatedAt_id_idx"
ON "Conversation"("companyId", "teamId", "updatedAt", "id");

CREATE INDEX "Conversation_companyId_channel_updatedAt_id_idx"
ON "Conversation"("companyId", "channel", "updatedAt", "id");

CREATE INDEX "Message_companyId_conversationId_createdAt_id_idx"
ON "Message"("companyId", "conversationId", "createdAt", "id");

CREATE INDEX "Ticket_companyId_updatedAt_id_idx"
ON "Ticket"("companyId", "updatedAt", "id");

CREATE INDEX "Ticket_companyId_status_updatedAt_id_idx"
ON "Ticket"("companyId", "status", "updatedAt", "id");

CREATE INDEX "Ticket_companyId_assigneeId_updatedAt_id_idx"
ON "Ticket"("companyId", "assigneeId", "updatedAt", "id");

CREATE INDEX "Ticket_companyId_teamId_updatedAt_id_idx"
ON "Ticket"("companyId", "teamId", "updatedAt", "id");

CREATE INDEX "Ticket_companyId_priority_updatedAt_id_idx"
ON "Ticket"("companyId", "priority", "updatedAt", "id");
