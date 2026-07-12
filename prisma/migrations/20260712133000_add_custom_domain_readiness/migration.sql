-- CreateEnum
CREATE TYPE "DomainVerificationStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "DomainSslStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Company"
ADD COLUMN "customSupportDomain" VARCHAR(255),
ADD COLUMN "verificationStatus" "DomainVerificationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
ADD COLUMN "verificationToken" VARCHAR(128),
ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "sslStatus" "DomainSslStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
ADD COLUMN "domainStatus" "DomainStatus" NOT NULL DEFAULT 'NOT_CONFIGURED';

-- CreateIndex
CREATE UNIQUE INDEX "Company_customSupportDomain_key" ON "Company"("customSupportDomain");
