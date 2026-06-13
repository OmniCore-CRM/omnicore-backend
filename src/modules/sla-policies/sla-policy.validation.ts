import { TicketPriority } from "@prisma/client";
import { z } from "zod";

const policyFields = {
  name: z.string().trim().min(1, "Name is required").max(120),
  priority: z.enum(TicketPriority),
  firstResponseMinutes: z.coerce.number().int().positive().max(525600),
  resolutionMinutes: z.coerce.number().int().positive().max(525600),
  enabled: z.boolean(),
};

export const createSlaPolicySchema = z.object({
  ...policyFields,
  enabled: policyFields.enabled.default(true),
});

export const updateSlaPolicySchema = z
  .object({
    name: policyFields.name.optional(),
    priority: policyFields.priority.optional(),
    firstResponseMinutes: policyFields.firstResponseMinutes.optional(),
    resolutionMinutes: policyFields.resolutionMinutes.optional(),
    enabled: policyFields.enabled.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export type CreateSlaPolicyInput = z.infer<typeof createSlaPolicySchema>;
export type UpdateSlaPolicyInput = z.infer<typeof updateSlaPolicySchema>;
