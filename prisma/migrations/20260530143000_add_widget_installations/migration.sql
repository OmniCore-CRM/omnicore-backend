-- CreateTable
CREATE TABLE "WidgetInstallation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WidgetInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WidgetInstallation_publicKey_key" ON "WidgetInstallation"("publicKey");

-- CreateIndex
CREATE INDEX "WidgetInstallation_companyId_idx" ON "WidgetInstallation"("companyId");

-- AddForeignKey
ALTER TABLE "WidgetInstallation" ADD CONSTRAINT "WidgetInstallation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
