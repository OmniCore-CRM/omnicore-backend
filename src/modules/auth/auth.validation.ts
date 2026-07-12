import { z } from "zod";

// ===== Register Validation =====
export const registerSchema = z.object({
  companyName: z
    .string()
    .min(2, "Company name must be at least 2 characters"),

  firstName: z
    .string()
    .min(2, "First name must be at least 2 characters"),

  lastName: z
    .string()
    .min(2, "Last name must be at least 2 characters"),

  email: z.email("Invalid email address"),

  password: z
    .string()
    .min(8, "Password must be at least 8 characters"),
});

export type RegisterInput = z.infer<typeof registerSchema>;

// ===== Login Validation =====
export const loginSchema = z.object({
  email: z.email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email("Invalid email address"),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(16, "Reset token is invalid"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters"),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().min(16, "Invite token is invalid"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const validateInviteQuerySchema = z.object({
  token: z.string().min(16, "Invite token is invalid"),
});

export type ValidateInviteQueryInput = z.infer<typeof validateInviteQuerySchema>;

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Display name must be at least 2 characters")
    .max(120, "Display name must be at most 120 characters"),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ===== Authenticated JWT request payload =====
export interface AuthenticatedUser {
  userId: string;
  companyId: string;
  role: string;
}