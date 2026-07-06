import { z } from "zod";

export const assignmentCenterOverviewQuerySchema = z.object({
  listLimit: z.coerce.number().int().positive().max(20).default(8),
  recentLimit: z.coerce.number().int().positive().max(20).default(8),
});

export type AssignmentCenterOverviewQueryInput = z.infer<
  typeof assignmentCenterOverviewQuerySchema
>;
