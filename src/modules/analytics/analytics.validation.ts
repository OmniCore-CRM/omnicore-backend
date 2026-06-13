import { z } from "zod";

export const analyticsRangeSchema = z.enum(["7d", "30d", "90d", "all"]);

export const analyticsOverviewQuerySchema = z.object({
  range: analyticsRangeSchema.default("30d"),
});

export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;
export type AnalyticsOverviewQueryInput = z.infer<
  typeof analyticsOverviewQuerySchema
>;
