-- CreateTable
CREATE TABLE "SavedReply" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedReply_companyId_idx" ON "SavedReply"("companyId");

-- CreateIndex
CREATE INDEX "SavedReply_createdById_idx" ON "SavedReply"("createdById");

-- CreateIndex
CREATE INDEX "SavedReply_companyId_title_idx" ON "SavedReply"("companyId", "title");

-- AddForeignKey
ALTER TABLE "SavedReply" ADD CONSTRAINT "SavedReply_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReply" ADD CONSTRAINT "SavedReply_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
