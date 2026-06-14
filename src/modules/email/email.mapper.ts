import type { EmailAccount } from "@prisma/client";

export const mapEmailAccount = (account: EmailAccount) => ({
  id: account.id,
  companyId: account.companyId,
  provider: account.provider,
  fromEmail: account.fromEmail,
  fromName: account.fromName,
  status: account.status,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
});

export const mapEmailAccounts = (accounts: EmailAccount[]) =>
  accounts.map(mapEmailAccount);
