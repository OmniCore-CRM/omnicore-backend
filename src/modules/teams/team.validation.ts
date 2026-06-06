import { z } from "zod";

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
});

export const updateTeamSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

export const addTeamMemberSchema = z.object({
  userId: z.string().trim().min(1).max(128),
});

export const assignTeamSchema = z.object({
  teamId: z.string().trim().min(1).max(128).nullable(),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type AssignTeamInput = z.infer<typeof assignTeamSchema>;
