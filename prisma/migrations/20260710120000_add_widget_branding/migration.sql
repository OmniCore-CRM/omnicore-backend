-- Phase 3: Widget Branding Management
-- Adds logo, hero image, and brand color to WidgetInstallation

ALTER TABLE "WidgetInstallation"
  ADD COLUMN "logoUrl"      TEXT,
  ADD COLUMN "heroImageUrl" TEXT,
  ADD COLUMN "brandColor"   TEXT;
