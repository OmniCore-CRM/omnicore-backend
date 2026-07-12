import { z } from "zod";

const companySlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hostnameLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const isIpv4 = (value: string) => {
  const parts = value.split(".");
  if (parts.length !== 4) return false;

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
};

const customSupportDomainSchema = z
  .string()
  .trim()
  .max(255, "Custom domain must be at most 255 characters")
  .superRefine((value, ctx) => {
    if (!value) return;

    if (value.includes("://")) {
      ctx.addIssue({
        code: "custom",
        message: "Custom domain must not include a protocol",
      });
      return;
    }

    if (value.includes("/")) {
      ctx.addIssue({
        code: "custom",
        message: "Custom domain must not include a path",
      });
      return;
    }

    if (value !== value.toLowerCase()) {
      ctx.addIssue({
        code: "custom",
        message: "Custom domain must be lowercase",
      });
      return;
    }

    if (value === "localhost" || value.endsWith(".localhost") || isIpv4(value)) {
      ctx.addIssue({
        code: "custom",
        message: "Custom domain must be a public hostname",
      });
      return;
    }

    const labels = value.split(".");
    if (labels.length < 2 || labels.some((label) => !hostnameLabelPattern.test(label))) {
      ctx.addIssue({
        code: "custom",
        message: "Custom domain must be a valid hostname",
      });
    }
  })
  .nullable()
  .optional();

export const companyPortalSettingsUpdateSchema = z.object({
  companySlug: z
    .string()
    .trim()
    .toLowerCase()
    .max(63, "Company slug must be at most 63 characters")
    .regex(
      companySlugPattern,
      "Company slug must contain lowercase letters, numbers, and single hyphens only"
    )
    .nullable()
    .optional(),
  supportPortalEnabled: z.boolean().optional(),
  customSupportDomain: customSupportDomainSchema,
});

export const companyProfileUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Company name must be at least 2 characters")
    .max(120, "Company name must be at most 120 characters"),
});

export type CompanyPortalSettingsUpdateInput = z.infer<
  typeof companyPortalSettingsUpdateSchema
>;

export type CompanyProfileUpdateInput = z.infer<typeof companyProfileUpdateSchema>;
