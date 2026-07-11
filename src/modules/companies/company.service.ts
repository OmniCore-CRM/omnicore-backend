import { Prisma } from "@prisma/client";
import { prisma } from "@/config/db.js";
import { HTTP_STATUS } from "@/core/constants/http-status.js";
import { AppError } from "@/core/errors/app-error.js";
import type { CompanyPortalSettingsUpdateInput } from "./company.validation.js";

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

const toPortalSettingsResponse = (company: {
  id: string;
  name: string;
  companySlug: string | null;
  supportPortalEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  companyId: company.id,
  companyName: company.name,
  companySlug: company.companySlug,
  supportPortalEnabled: company.supportPortalEnabled,
  createdAt: company.createdAt,
  updatedAt: company.updatedAt,
});

export class CompanyService {
  static async getPortalSettings(companyId: string) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        companySlug: true,
        supportPortalEnabled: true,
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

    try {
      const company = await prisma.company.update({
        where: { id: companyId },
        data: {
          ...(normalizedSlug !== undefined ? { companySlug: normalizedSlug } : {}),
          ...(typeof input.supportPortalEnabled === "boolean"
            ? { supportPortalEnabled: input.supportPortalEnabled }
            : {}),
        },
        select: {
          id: true,
          name: true,
          companySlug: true,
          supportPortalEnabled: true,
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
        throw new AppError("Company slug already exists", HTTP_STATUS.CONFLICT, {
          code: "COMPANY_SLUG_CONFLICT",
        });
      }

      throw error;
    }
  }
}
