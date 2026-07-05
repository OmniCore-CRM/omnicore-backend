-- Add invite token lifecycle storage for Phase 1B user onboarding.
CREATE TABLE "UserInviteToken" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "invitedById" TEXT,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserInviteToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserInviteToken_tokenHash_key"
ON "UserInviteToken"("tokenHash");

CREATE INDEX "UserInviteToken_companyId_idx"
ON "UserInviteToken"("companyId");

CREATE INDEX "UserInviteToken_userId_idx"
ON "UserInviteToken"("userId");

CREATE INDEX "UserInviteToken_invitedById_idx"
ON "UserInviteToken"("invitedById");

CREATE INDEX "UserInviteToken_expiresAt_idx"
ON "UserInviteToken"("expiresAt");

CREATE INDEX "UserInviteToken_consumedAt_idx"
ON "UserInviteToken"("consumedAt");

CREATE INDEX "UserInviteToken_revokedAt_idx"
ON "UserInviteToken"("revokedAt");

ALTER TABLE "UserInviteToken"
ADD CONSTRAINT "UserInviteToken_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserInviteToken"
ADD CONSTRAINT "UserInviteToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserInviteToken"
ADD CONSTRAINT "UserInviteToken_invitedById_fkey"
FOREIGN KEY ("invitedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
