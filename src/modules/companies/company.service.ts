import { randomBytes } from "crypto";
import {
  DomainSslStatus,
  DomainStatus,
  DomainVerificationStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/config/db.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import type {
  CompanyPortalSettingsUpdateInput,
  CompanyProfileUpdateInput,
} from "./company.validation.js";

const reservedPortalSlugs = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "billing",
  "dashboard",
  "help",
  "home",
  "knowledge-base",
  "login",
  "logout",
  "register",
  "settings",
  "signup",
  "support",
  "widget",
]);

const normalizeCompanySlug = (value: string | null | undefined) => {
  if (value === null) return null;
  if (value === undefined) return undefined;

  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const normalizeCustomSupportDomain = (value: string | null | undefined) => {
  if (value === null) return null;
  if (value === undefined) return undefined;

  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const createVerificationToken = () => randomBytes(24).toString("hex");

const toPortalSettingsResponse = (company: {
  id: string;
  name: string;
  companySlug: string | null;
  supportPortalEnabled: boolean;
  customSupportDomain: string | null;
  verificationStatus: DomainVerificationStatus;
  verificationToken: string | null;
  verifiedAt: Date | null;
  sslStatus: DomainSslStatus;
  domainStatus: DomainStatus;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  companyId: company.id,
  companyName: company.name,
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
});

export class CompanyService {
  static async updateCompanyProfile(
    companyId: string,
    input: CompanyProfileUpdateInput,
  ) {
    const company = await prisma.company.update({
      where: { id: companyId },
      data: {
        name: input.name.trim(),
      },
    });

    return {
      company: {
        id: company.id,
        name: company.name,
        companySlug: company.companySlug,
        supportPortalEnabled: company.supportPortalEnabled,
      },
    };
  }

  static async getPortalSettings(companyId: string) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        companySlug: true,
        supportPortalEnabled: true,
        customSupportDomain: true,
        verificationStatus: true,
        verificationToken: true,
        verifiedAt: true,
        sslStatus: true,
        domainStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!company) {
      throw new AppError("Company not found", HTTP_STATUS.NOT_FOUND);
    }

    return toPortalSettingsResponse(company);
  }

  static async updatePortalSettings(
    companyId: string,
    input: CompanyPortalSettingsUpdateInput
  ) {
    const normalizedSlug = normalizeCompanySlug(input.companySlug);
    const normalizedCustomSupportDomain = normalizeCustomSupportDomain(
      input.customSupportDomain
    );

    const existingCompany = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        companySlug: true,
        supportPortalEnabled: true,
        customSupportDomain: true,
        verificationStatus: true,
        verificationToken: true,
        verifiedAt: true,
        sslStatus: true,
        domainStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!existingCompany) {
      throw new AppError("Company not found", HTTP_STATUS.NOT_FOUND);
    }

    if (normalizedSlug && reservedPortalSlugs.has(normalizedSlug)) {
      throw new AppError(
        "This company slug is reserved and cannot be used",
        HTTP_STATUS.BAD_REQUEST,
        {
          code: "RESERVED_COMPANY_SLUG",
        }
      );
    }

    if (normalizedSlug) {
      const existing = await prisma.company.findFirst({
        where: {
          companySlug: normalizedSlug,
          id: {
            not: companyId,
          },
        },
        select: {
          id: true,
        },
      });

      if (existing) {
        throw new AppError("Company slug already exists", HTTP_STATUS.CONFLICT, {
          code: "COMPANY_SLUG_CONFLICT",
        });
      }
    }

    if (normalizedCustomSupportDomain) {
      const existing = await prisma.company.findFirst({
        where: {
          customSupportDomain: normalizedCustomSupportDomain,
          id: {
            not: companyId,
          },
        },
        select: {
          id: true,
        },
      });

      if (existing) {
        throw new AppError(
          "Custom support domain is already claimed",
          HTTP_STATUS.CONFLICT,
          {
            code: "CUSTOM_DOMAIN_CONFLICT",
          }
        );
      }
    }

    try {
      const data: Prisma.CompanyUpdateInput = {
        ...(normalizedSlug !== undefined ? { companySlug: normalizedSlug } : {}),
        ...(typeof input.supportPortalEnabled === "boolean"
          ? { supportPortalEnabled: input.supportPortalEnabled }
          : {}),
      };

      if (input.customSupportDomain !== undefined) {
        if (!normalizedCustomSupportDomain) {
          data.customSupportDomain = null;
          data.verificationStatus = DomainVerificationStatus.NOT_CONFIGURED;
          data.verificationToken = null;
          data.verifiedAt = null;
          data.sslStatus = DomainSslStatus.NOT_CONFIGURED;
          data.domainStatus = DomainStatus.NOT_CONFIGURED;
        } else {
          data.customSupportDomain = normalizedCustomSupportDomain;

          if (existingCompany.customSupportDomain !== normalizedCustomSupportDomain) {
            data.verificationStatus = DomainVerificationStatus.PENDING;
            data.verificationToken = createVerificationToken();
            data.verifiedAt = null;
            data.sslStatus = DomainSslStatus.PENDING;
            data.domainStatus = DomainStatus.PENDING;
          }
        }
      }

      const company = await prisma.company.update({
        where: { id: companyId },
        data,
        select: {
          id: true,
          name: true,
          companySlug: true,
          supportPortalEnabled: true,
          customSupportDomain: true,
          verificationStatus: true,
          verificationToken: true,
          verifiedAt: true,
          sslStatus: true,
          domainStatus: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return toPortalSettingsResponse(company);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        if ((error.meta?.target as string[] | undefined)?.includes("companySlug")) {
          throw new AppError("Company slug already exists", HTTP_STATUS.CONFLICT, {
            code: "COMPANY_SLUG_CONFLICT",
          });
        }

        if (
          (error.meta?.target as string[] | undefined)?.includes(
            "customSupportDomain"
          )
        ) {
          throw new AppError(
            "Custom support domain is already claimed",
            HTTP_STATUS.CONFLICT,
            {
              code: "CUSTOM_DOMAIN_CONFLICT",
            }
          );
        }
      }

      throw error;
    }
  }
}
