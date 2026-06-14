-- CreateEnum
CREATE TYPE "AssignmentRuleTargetType" AS ENUM ('CONVERSATION', 'TICKET');

-- CreateEnum
CREATE TYPE "AssignmentRuleConditionType" AS ENUM ('CHANNEL', 'PRIORITY', 'TAG');

-- AlterEnum
ALTER TYPE "ConversationActivityAction" ADD VALUE 'AUTO_TEAM_ASSIGNED';

-- AlterEnum
ALTER TYPE "TicketActivityAction" ADD VALUE 'AUTO_TEAM_ASSIGNED';

-- AlterTable
ALTER TABLE "ConversationActivity" ALTER COLUMN "actorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TicketActivity" ALTER COLUMN "actorId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AssignmentRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "targetType" "AssignmentRuleTargetType" NOT NULL,
    "conditionType" "AssignmentRuleConditionType" NOT NULL,
    "conditionValue" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentRule_companyId_name_key" ON "AssignmentRule"("companyId", "name");

-- CreateIndex
CREATE INDEX "AssignmentRule_companyId_targetType_enabled_createdAt_idx" ON "AssignmentRule"("companyId", "targetType", "enabled", "createdAt");

-- CreateIndex
CREATE INDEX "AssignmentRule_companyId_teamId_idx" ON "AssignmentRule"("companyId", "teamId");

-- AddForeignKey
ALTER TABLE "AssignmentRule" ADD CONSTRAINT "AssignmentRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentRule" ADD CONSTRAINT "AssignmentRule_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
