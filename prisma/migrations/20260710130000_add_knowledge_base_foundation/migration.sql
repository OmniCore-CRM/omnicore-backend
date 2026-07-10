-- CreateEnum WidgetArticleStatus
CREATE TYPE "WidgetArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable WidgetArticleCategory
CREATE TABLE "WidgetArticleCategory" (
    id TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "widgetInstallationId" TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WidgetArticleCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WidgetArticleCategory_widgetInstallationId_fkey" FOREIGN KEY ("widgetInstallationId") REFERENCES "WidgetInstallation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WidgetArticleCategory_widgetInstallationId_slug_key" UNIQUE("widgetInstallationId", slug)
);

-- CreateTable WidgetArticle
CREATE TABLE "WidgetArticle" (
    id TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "widgetInstallationId" TEXT NOT NULL,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    summary TEXT NOT NULL,
    content TEXT NOT NULL,
    "categoryId" TEXT,
    status "WidgetArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WidgetArticle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WidgetArticle_widgetInstallationId_fkey" FOREIGN KEY ("widgetInstallationId") REFERENCES "WidgetInstallation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WidgetArticle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "WidgetArticleCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WidgetArticle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WidgetArticle_widgetInstallationId_slug_key" UNIQUE("widgetInstallationId", slug)
);

-- CreateIndex WidgetArticleCategory_companyId_idx
CREATE INDEX "WidgetArticleCategory_companyId_idx" ON "WidgetArticleCategory"("companyId");

-- CreateIndex WidgetArticleCategory_widgetInstallationId_idx
CREATE INDEX "WidgetArticleCategory_widgetInstallationId_idx" ON "WidgetArticleCategory"("widgetInstallationId");

-- CreateIndex WidgetArticleCategory_companyId_widgetInstallationId_idx
CREATE INDEX "WidgetArticleCategory_companyId_widgetInstallationId_idx" ON "WidgetArticleCategory"("companyId", "widgetInstallationId");

-- CreateIndex WidgetArticle_companyId_idx
CREATE INDEX "WidgetArticle_companyId_idx" ON "WidgetArticle"("companyId");

-- CreateIndex WidgetArticle_widgetInstallationId_idx
CREATE INDEX "WidgetArticle_widgetInstallationId_idx" ON "WidgetArticle"("widgetInstallationId");

-- CreateIndex WidgetArticle_companyId_widgetInstallationId_idx
CREATE INDEX "WidgetArticle_companyId_widgetInstallationId_idx" ON "WidgetArticle"("companyId", "widgetInstallationId");

-- CreateIndex WidgetArticle_widgetInstallationId_status_idx
CREATE INDEX "WidgetArticle_widgetInstallationId_status_idx" ON "WidgetArticle"("widgetInstallationId", status);

-- CreateIndex WidgetArticle_categoryId_idx
CREATE INDEX "WidgetArticle_categoryId_idx" ON "WidgetArticle"("categoryId");

-- CreateIndex WidgetArticle_createdById_idx
CREATE INDEX "WidgetArticle_createdById_idx" ON "WidgetArticle"("createdById");
