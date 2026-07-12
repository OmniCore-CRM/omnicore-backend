import type { Company } from "@prisma/client";

// ===== Normalize single company response =====
export const mapCompany = (company: Company) => {
  return {
    id: company.id,

    name: company.name,
    companySlug: company.companySlug,
    supportPortalEnabled: company.supportPortalEnabled,
    customSupportDomain: company.customSupportDomain,
    verificationStatus: company.verificationStatus,
    verificationToken: company.verificationToken,
    verifiedAt: company.verifiedAt,
    sslStatus: company.sslStatus,
    domainStatus: company.domainStatus,

    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
};

// ===== Normalize multiple companies response =====
export const mapCompanies = (companies: Company[]) => {
  return companies.map(mapCompany);
};