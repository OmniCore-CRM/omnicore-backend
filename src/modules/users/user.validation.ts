import { UserLifecycleStatus, UserRole } from "@prisma/client";
import { z } from "zod";

const userRoleSchema = z.enum(UserRole);
const userStatusSchema = z.enum(UserLifecycleStatus);

export const userListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  role: userRoleSchema.optional(),
  status: userStatusSchema.optional(),
});

export const createUserSchema = z.object({
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8).max(128),
  role: userRoleSchema,
  status: userStatusSchema.default(UserLifecycleStatus.INVITED),
});

export const updateUserSchema = z.object({
  firstName: z.string().trim().min(2).max(80).optional(),
  lastName: z.string().trim().min(2).max(80).optional(),
  email: z
    .email()
    .transform((value) => value.trim().toLowerCase())
    .optional(),
  role: userRoleSchema.optional(),
});

export const updateUserStatusSchema = z.object({
  status: userStatusSchema,
});

export type UserListQueryInput = z.infer<typeof userListQuerySchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
