-- AlterTable: add Phase 1 landing page customisation fields to WidgetInstallation
ALTER TABLE "WidgetInstallation"
  ADD COLUMN "companyDisplayName" TEXT,
  ADD COLUMN "welcomeTitle" TEXT,
  ADD COLUMN "welcomeSubtitle" TEXT,
  ADD COLUMN "chatGreeting" TEXT,
  ADD COLUMN "launcherLabel" TEXT,
  ADD COLUMN "footerNote" TEXT,
  ADD COLUMN "messageShortcuts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
