import { z } from "zod";

export const customerListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  tagId: z.string().trim().min(1).max(128).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  lastActivityFrom: z.coerce.date().optional(),
  lastActivityTo: z.coerce.date().optional(),
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().positive().max(100).default(30),
});

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

export type CustomerListQueryInput = z.infer<
  typeof customerListQuerySchema
>;
