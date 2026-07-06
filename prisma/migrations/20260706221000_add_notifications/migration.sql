-- Phase 6: notifications persistence
-- Apply manually in Supabase SQL Editor as per project workflow.

CREATE TYPE "NotificationType" AS ENUM (
  'TICKET_ASSIGNED',
  'CONVERSATION_ASSIGNED',
  'TICKET_TEAM_ASSIGNED',
  'CONVERSATION_TEAM_ASSIGNED',
  'TICKET_MENTION',
  'CONVERSATION_MENTION',
  'INVITE_ACCEPTED',
  'USER_ACTIVATED',
  'TEAM_MEMBER_ADDED',
  'ROLE_CHANGED'
);

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "metadata" JSONB,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_companyId_idx" ON "Notification"("companyId");
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");
CREATE INDEX "Notification_companyId_userId_createdAt_id_idx"
  ON "Notification"("companyId", "userId", "createdAt", "id");
CREATE INDEX "Notification_companyId_userId_isRead_createdAt_id_idx"
  ON "Notification"("companyId", "userId", "isRead", "createdAt", "id");
CREATE INDEX "Notification_companyId_userId_type_entityType_entityId_idx"
  ON "Notification"("companyId", "userId", "type", "entityType", "entityId");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
