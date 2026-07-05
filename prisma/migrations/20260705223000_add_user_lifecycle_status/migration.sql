-- Add explicit user lifecycle state for company user management.
CREATE TYPE "UserLifecycleStatus" AS ENUM (
  'INVITED',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED'
);

ALTER TABLE "User"
ADD COLUMN "status" "UserLifecycleStatus" NOT NULL DEFAULT 'ACTIVE';

UPDATE "User"
SET "status" = CASE
  WHEN "isActive" = true THEN 'ACTIVE'::"UserLifecycleStatus"
  ELSE 'DEACTIVATED'::"UserLifecycleStatus"
END;

CREATE INDEX "User_companyId_status_firstName_lastName_idx"
ON "User"("companyId", "status", "firstName", "lastName");
