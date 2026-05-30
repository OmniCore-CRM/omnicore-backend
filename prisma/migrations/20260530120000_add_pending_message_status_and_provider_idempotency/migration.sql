-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'PENDING';

-- CreateIndex
CREATE INDEX "Message_companyId_provider_externalMessageId_idx" ON "Message"("companyId", "provider", "externalMessageId");
