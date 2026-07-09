-- CreateTable: WidgetFaqEntry — Phase 2 FAQ management
CREATE TABLE "WidgetFaqEntry" (
    "id" TEXT NOT NULL,
    "widgetInstallationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WidgetFaqEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WidgetFaqEntry_widgetInstallationId_idx" ON "WidgetFaqEntry"("widgetInstallationId");

-- CreateIndex
CREATE INDEX "WidgetFaqEntry_companyId_idx" ON "WidgetFaqEntry"("companyId");

-- AddForeignKey
ALTER TABLE "WidgetFaqEntry" ADD CONSTRAINT "WidgetFaqEntry_widgetInstallationId_fkey"
    FOREIGN KEY ("widgetInstallationId") REFERENCES "WidgetInstallation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetFaqEntry" ADD CONSTRAINT "WidgetFaqEntry_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
