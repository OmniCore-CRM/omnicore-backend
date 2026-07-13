-- Durable webhook replay/idempotency ledger for provider event processing.
CREATE TYPE "WebhookProvider" AS ENUM ('WHATSAPP', 'EMAIL');

CREATE TABLE "WebhookReplayLedger" (
    "id" TEXT NOT NULL,
    "provider" "WebhookProvider" NOT NULL,
    "eventType" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "companyId" TEXT,
    "providerEventId" TEXT,
    "signatureFingerprint" TEXT,
    "payloadFingerprint" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstRequestId" TEXT,
    "lastRequestId" TEXT,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "lastReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookReplayLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookReplayLedger_identityKey_key" ON "WebhookReplayLedger"("identityKey");
CREATE INDEX "WebhookReplayLedger_provider_companyId_eventType_idx" ON "WebhookReplayLedger"("provider", "companyId", "eventType");
CREATE INDEX "WebhookReplayLedger_provider_providerEventId_idx" ON "WebhookReplayLedger"("provider", "providerEventId");
CREATE INDEX "WebhookReplayLedger_companyId_updatedAt_idx" ON "WebhookReplayLedger"("companyId", "updatedAt");

ALTER TABLE "WebhookReplayLedger" ADD CONSTRAINT "WebhookReplayLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
