-- CreateEnum
CREATE TYPE "FeedbackSurveyType" AS ENUM ('CSAT', 'NPS');

-- CreateEnum
CREATE TYPE "FeedbackSurveyStatus" AS ENUM ('PENDING', 'SENT', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FeedbackTriggerSource" AS ENUM ('TICKET_RESOLVED', 'CONVERSATION_RESOLVED');

-- CreateEnum
CREATE TYPE "FeedbackTriggerMode" AS ENUM ('DISABLED', 'CSAT', 'NPS', 'BOTH');

-- CreateEnum
CREATE TYPE "FeedbackSentiment" AS ENUM ('DETRACTOR', 'NEUTRAL', 'SATISFIED', 'PASSIVE', 'PROMOTER');

-- CreateEnum
CREATE TYPE "FeedbackEscalationStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'FEEDBACK_DETRACTOR_ESCALATION';

-- DropForeignKey
ALTER TABLE "ConversationActivity" DROP CONSTRAINT "ConversationActivity_actorId_fkey";

-- DropForeignKey
ALTER TABLE "TicketActivity" DROP CONSTRAINT "TicketActivity_actorId_fkey";

-- AlterTable
ALTER TABLE "WidgetFaqEntry" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "WidgetInstallation" ALTER COLUMN "allowedDomains" DROP DEFAULT,
ALTER COLUMN "messageShortcuts" DROP DEFAULT;

-- CreateTable
CREATE TABLE "FeedbackTriggerConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" "FeedbackTriggerSource" NOT NULL,
    "mode" "FeedbackTriggerMode" NOT NULL DEFAULT 'CSAT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackTriggerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackSurvey" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "ticketId" TEXT,
    "channel" "ConversationChannel",
    "assigneeId" TEXT,
    "type" "FeedbackSurveyType" NOT NULL,
    "status" "FeedbackSurveyStatus" NOT NULL DEFAULT 'PENDING',
    "triggerSource" "FeedbackTriggerSource" NOT NULL,
    "triggerEventKey" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackResponse" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "ticketId" TEXT,
    "channel" "ConversationChannel",
    "assigneeId" TEXT,
    "type" "FeedbackSurveyType" NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "sentiment" "FeedbackSentiment" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackEscalation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "status" "FeedbackEscalationStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "assignedToId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedbackTriggerConfig_companyId_idx" ON "FeedbackTriggerConfig"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackTriggerConfig_companyId_source_key" ON "FeedbackTriggerConfig"("companyId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackSurvey_tokenHash_key" ON "FeedbackSurvey"("tokenHash");

-- CreateIndex
CREATE INDEX "FeedbackSurvey_companyId_idx" ON "FeedbackSurvey"("companyId");

-- CreateIndex
CREATE INDEX "FeedbackSurvey_companyId_status_createdAt_idx" ON "FeedbackSurvey"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackSurvey_companyId_type_status_createdAt_idx" ON "FeedbackSurvey"("companyId", "type", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackSurvey_companyId_triggerSource_triggerEventKey_idx" ON "FeedbackSurvey"("companyId", "triggerSource", "triggerEventKey");

-- CreateIndex
CREATE INDEX "FeedbackSurvey_companyId_customerId_idx" ON "FeedbackSurvey"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "FeedbackSurvey_conversationId_idx" ON "FeedbackSurvey"("conversationId");

-- CreateIndex
CREATE INDEX "FeedbackSurvey_ticketId_idx" ON "FeedbackSurvey"("ticketId");

-- CreateIndex
CREATE INDEX "FeedbackSurvey_assigneeId_idx" ON "FeedbackSurvey"("assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackResponse_surveyId_key" ON "FeedbackResponse"("surveyId");

-- CreateIndex
CREATE INDEX "FeedbackResponse_companyId_idx" ON "FeedbackResponse"("companyId");

-- CreateIndex
CREATE INDEX "FeedbackResponse_companyId_type_submittedAt_idx" ON "FeedbackResponse"("companyId", "type", "submittedAt");

-- CreateIndex
CREATE INDEX "FeedbackResponse_companyId_sentiment_submittedAt_idx" ON "FeedbackResponse"("companyId", "sentiment", "submittedAt");

-- CreateIndex
CREATE INDEX "FeedbackResponse_companyId_channel_submittedAt_idx" ON "FeedbackResponse"("companyId", "channel", "submittedAt");

-- CreateIndex
CREATE INDEX "FeedbackResponse_companyId_assigneeId_submittedAt_idx" ON "FeedbackResponse"("companyId", "assigneeId", "submittedAt");

-- CreateIndex
CREATE INDEX "FeedbackResponse_companyId_customerId_idx" ON "FeedbackResponse"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "FeedbackResponse_conversationId_idx" ON "FeedbackResponse"("conversationId");

-- CreateIndex
CREATE INDEX "FeedbackResponse_ticketId_idx" ON "FeedbackResponse"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackEscalation_surveyId_key" ON "FeedbackEscalation"("surveyId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackEscalation_responseId_key" ON "FeedbackEscalation"("responseId");

-- CreateIndex
CREATE INDEX "FeedbackEscalation_companyId_idx" ON "FeedbackEscalation"("companyId");

-- CreateIndex
CREATE INDEX "FeedbackEscalation_companyId_status_createdAt_idx" ON "FeedbackEscalation"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackEscalation_companyId_assignedToId_status_idx" ON "FeedbackEscalation"("companyId", "assignedToId", "status");

-- AddForeignKey
ALTER TABLE "ConversationActivity" ADD CONSTRAINT "ConversationActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketActivity" ADD CONSTRAINT "TicketActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackTriggerConfig" ADD CONSTRAINT "FeedbackTriggerConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackSurvey" ADD CONSTRAINT "FeedbackSurvey_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackSurvey" ADD CONSTRAINT "FeedbackSurvey_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackSurvey" ADD CONSTRAINT "FeedbackSurvey_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackSurvey" ADD CONSTRAINT "FeedbackSurvey_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackSurvey" ADD CONSTRAINT "FeedbackSurvey_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackResponse" ADD CONSTRAINT "FeedbackResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "FeedbackSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackResponse" ADD CONSTRAINT "FeedbackResponse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackResponse" ADD CONSTRAINT "FeedbackResponse_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackResponse" ADD CONSTRAINT "FeedbackResponse_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackResponse" ADD CONSTRAINT "FeedbackResponse_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackEscalation" ADD CONSTRAINT "FeedbackEscalation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackEscalation" ADD CONSTRAINT "FeedbackEscalation_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "FeedbackSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackEscalation" ADD CONSTRAINT "FeedbackEscalation_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "FeedbackResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackEscalation" ADD CONSTRAINT "FeedbackEscalation_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

