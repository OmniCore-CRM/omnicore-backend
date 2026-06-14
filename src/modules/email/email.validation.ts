import { EmailAccountStatus, EmailProvider } from "@prisma/client";
import { z } from "zod";

export const createEmailAccountSchema = z.object({
  provider: z.enum(EmailProvider).default(EmailProvider.RESEND),
  fromEmail: z.string().trim().email().max(320),
  fromName: z.string().trim().min(1).max(120).optional(),
  status: z.enum(EmailAccountStatus).default(EmailAccountStatus.ACTIVE),
});

export const updateEmailAccountSchema = z
  .object({
    fromEmail: z.string().trim().email().max(320).optional(),
    fromName: z.string().trim().min(1).max(120).nullable().optional(),
    status: z.enum(EmailAccountStatus).optional(),
  })
  .refine(
    (value) =>
      value.fromEmail !== undefined ||
      value.fromName !== undefined ||
      value.status !== undefined,
    { message: "At least one field is required" }
  );

export type CreateEmailAccountInput = z.infer<typeof createEmailAccountSchema>;
export type UpdateEmailAccountInput = z.infer<typeof updateEmailAccountSchema>;
