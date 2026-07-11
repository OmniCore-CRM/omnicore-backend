-- Phase 5A: Public Support Portal data foundation (additive, rollback-safe)
ALTER TABLE "Company"
ADD COLUMN "companySlug" VARCHAR(63),
ADD COLUMN "supportPortalEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Company_companySlug_key"
ON "Company"("companySlug");
