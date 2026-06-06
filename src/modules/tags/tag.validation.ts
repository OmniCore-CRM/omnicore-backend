import { z } from "zod";

const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value like #7c3aed")
  .nullable()
  .optional();

export const tagListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});

export const createTagSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Tag name is required")
    .max(60, "Tag name is too long"),
  color: colorSchema,
});

export const updateTagSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Tag name is required")
      .max(60, "Tag name is too long")
      .optional(),
    color: colorSchema,
  })
  .refine((value) => value.name !== undefined || value.color !== undefined, {
    message: "At least one field is required",
  });

export const attachTagSchema = z.object({
  tagId: z.string().trim().min(1, "Tag ID is required").max(128),
});

export type TagListQueryInput = z.infer<typeof tagListQuerySchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
export type AttachTagInput = z.infer<typeof attachTagSchema>;
