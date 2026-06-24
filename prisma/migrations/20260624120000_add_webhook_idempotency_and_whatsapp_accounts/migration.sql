-- Tenant-owned WhatsApp provider account mapping. Inbound Meta webhooks must map
-- by phone_number_id before messages are accepted into a company tenant.
CREATE TYPE "ProviderAccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "WhatsAppAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT,
    "status" "ProviderAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppAccount_phoneNumberId_key" ON "WhatsAppAccount"("phoneNumberId");
CREATE INDEX "WhatsAppAccount_companyId_status_idx" ON "WhatsAppAccount"("companyId", "status");

ALTER TABLE "WhatsAppAccount" ADD CONSTRAINT "WhatsAppAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve all historical message rows while making provider IDs unique going
-- forward. Any non-canonical duplicate keeps its content and gains a metadata
-- note, but no longer participates in provider-id replay matching.
WITH ranked_provider_messages AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "companyId", "provider", "externalMessageId"
            ORDER BY "createdAt" ASC, "id" ASC
        ) AS duplicate_rank
    FROM "Message"
    WHERE "provider" IS NOT NULL
      AND "externalMessageId" IS NOT NULL
)
UPDATE "Message" AS message
SET
    "metadata" = COALESCE(message."metadata", '{}'::jsonb) || jsonb_build_object(
        'securityIdempotencyNote', 'duplicate provider id cleared during Phase 2 webhook hardening',
        'previousExternalMessageId', message."externalMessageId"
    ),
    "externalMessageId" = NULL
FROM ranked_provider_messages
WHERE message."id" = ranked_provider_messages."id"
  AND ranked_provider_messages.duplicate_rank > 1;

-- DB-enforced provider message idempotency for real provider messages. PostgreSQL
-- partial unique index preserves multiple local/non-provider messages with NULLs.
CREATE UNIQUE INDEX "Message_provider_external_id_unique" ON "Message"("companyId", "provider", "externalMessageId") WHERE "provider" IS NOT NULL AND "externalMessageId" IS NOT NULL;
