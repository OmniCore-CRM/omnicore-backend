import { z } from "zod";

// ===== Create Customer Validation =====
export const createCustomerSchema = z.object({
  firstName: z
    .string()
    .min(2, "First name must be at least 2 characters"),

  lastName: z
    .string()
    .min(2, "Last name must be at least 2 characters")
    .optional(),

  email: z
    .email("Invalid email address")
    .optional(),

  phone: z
    .string()
    .min(7, "Phone number is too short")
    .optional(),
});

export type CreateCustomerInput = z.infer<
  typeof createCustomerSchema
>;