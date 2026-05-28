import type { Company } from "@prisma/client";

// ===== Normalize single company response =====
export const mapCompany = (company: Company) => {
  return {
    id: company.id,

    name: company.name,

    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
};

// ===== Normalize multiple companies response =====
export const mapCompanies = (companies: Company[]) => {
  return companies.map(mapCompany);
};