import { z } from "zod";

const companySlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
});

export type CompanyPortalSettingsUpdateInput = z.infer<
  typeof companyPortalSettingsUpdateSchema
>;
