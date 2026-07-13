-- Workstream B foundation: retry state, DLQ, and reconciliation run tracking.

CREATE TYPE "ChannelRetryState" AS ENUM (
    'PENDING',
    'RETRY_SCHEDULED',
    'PROCESSING',
    'SUCCEEDED',
    'FAILED',
    'EXHAUSTED'
);

CREATE TYPE "ChannelDlqReason" AS ENUM (
    'RETRY_EXHAUSTED',
    'DELIVERY_UNMATCHED',
    'INVALID_LIFECYCLE_TRANSITION',
    'PROVIDER_PROCESSING_FAILURE'
);

CREATE TYPE "ChannelDlqState" AS ENUM (
    'OPEN',
    'REPROCESSING',
    'RESOLVED',
    'DISMISSED'
);

CREATE TYPE "ReconciliationRunStatus" AS ENUM (
    'STARTED',
    'COMPLETED',
    'FAILED'
);

CREATE TABLE "MessageRetryState" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "ConversationChannel" NOT NULL,
    "state" "ChannelRetryState" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureCode" TEXT,
    "lastFailureReason" TEXT,
    "lastHttpStatus" INTEGER,
    "lockedAt" TIMESTAMP(3),
    "lockToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageRetryState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageRetryState_messageId_key" ON "MessageRetryState"("messageId");
CREATE INDEX "MessageRetryState_companyId_provider_state_nextAttemptAt_idx" ON "MessageRetryState"("companyId", "provider", "state", "nextAttemptAt");
CREATE INDEX "MessageRetryState_state_nextAttemptAt_idx" ON "MessageRetryState"("state", "nextAttemptAt");

CREATE TABLE "ChannelDeadLetterItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "provider" "ConversationChannel" NOT NULL,
    "reason" "ChannelDlqReason" NOT NULL,
    "state" "ChannelDlqState" NOT NULL DEFAULT 'OPEN',
    "sourceEventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "messageId" TEXT,
    "externalMessageId" TEXT,
    "providerAccountId" TEXT,
    "failureCode" TEXT,
    "failureReason" TEXT NOT NULL,
    "failureMeta" JSONB,
    "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelDeadLetterItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChannelDeadLetterItem_provider_reason_state_nextRetryAt_idx" ON "ChannelDeadLetterItem"("provider", "reason", "state", "nextRetryAt");
CREATE INDEX "ChannelDeadLetterItem_companyId_state_nextRetryAt_idx" ON "ChannelDeadLetterItem"("companyId", "state", "nextRetryAt");
CREATE INDEX "ChannelDeadLetterItem_externalMessageId_idx" ON "ChannelDeadLetterItem"("externalMessageId");

CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "runType" TEXT NOT NULL,
    "status" "ReconciliationRunStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "createdDlqCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReconciliationRun_runType_status_startedAt_idx" ON "ReconciliationRun"("runType", "status", "startedAt");
CREATE INDEX "ReconciliationRun_companyId_startedAt_idx" ON "ReconciliationRun"("companyId", "startedAt");

ALTER TABLE "MessageRetryState"
ADD CONSTRAINT "MessageRetryState_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageRetryState"
ADD CONSTRAINT "MessageRetryState_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelDeadLetterItem"
ADD CONSTRAINT "ChannelDeadLetterItem_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChannelDeadLetterItem"
ADD CONSTRAINT "ChannelDeadLetterItem_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReconciliationRun"
ADD CONSTRAINT "ReconciliationRun_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
