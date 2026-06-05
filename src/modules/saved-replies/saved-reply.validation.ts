import { z } from "zod";

export const savedReplyListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});

export const createSavedReplySchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(120, "Title is too long"),
  content: z
    .string()
    .trim()
    .min(1, "Content is required")
    .max(5000, "Content is too long"),
});

export const updateSavedReplySchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(120, "Title is too long")
      .optional(),
    content: z
      .string()
      .trim()
      .min(1, "Content is required")
      .max(5000, "Content is too long")
      .optional(),
  })
  .refine((value) => value.title !== undefined || value.content !== undefined, {
    message: "At least one field is required",
  });

export type SavedReplyListQueryInput = z.infer<
  typeof savedReplyListQuerySchema
>;
export type CreateSavedReplyInput = z.infer<typeof createSavedReplySchema>;
export type UpdateSavedReplyInput = z.infer<typeof updateSavedReplySchema>;
