CREATE TYPE "SlaStatus" AS ENUM ('ON_TRACK', 'AT_RISK', 'BREACHED', 'PAUSED');

ALTER TYPE "TicketActivityAction" ADD VALUE 'SLA_UPDATED';
ALTER TYPE "TicketActivityAction" ADD VALUE 'SLA_BREACHED';

ALTER TABLE "Ticket"
ADD COLUMN "firstResponseDueAt" TIMESTAMP(3),
ADD COLUMN "resolutionDueAt" TIMESTAMP(3),
ADD COLUMN "firstRespondedAt" TIMESTAMP(3),
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "slaStatus" "SlaStatus" NOT NULL DEFAULT 'ON_TRACK';

CREATE TABLE "SlaPolicy" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priority" "TicketPriority" NOT NULL,
  "firstResponseMinutes" INTEGER NOT NULL,
  "resolutionMinutes" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SlaPolicy_companyId_name_key" ON "SlaPolicy"("companyId", "name");
CREATE INDEX "SlaPolicy_companyId_priority_enabled_idx" ON "SlaPolicy"("companyId", "priority", "enabled");
CREATE INDEX "Ticket_companyId_slaStatus_idx" ON "Ticket"("companyId", "slaStatus");
CREATE INDEX "Ticket_firstResponseDueAt_idx" ON "Ticket"("firstResponseDueAt");
CREATE INDEX "Ticket_resolutionDueAt_idx" ON "Ticket"("resolutionDueAt");

ALTER TABLE "SlaPolicy"
ADD CONSTRAINT "SlaPolicy_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
