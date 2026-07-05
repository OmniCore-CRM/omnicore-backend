import { z } from "zod";

export const analyticsRangeSchema = z.enum(["7d", "30d", "90d", "all"]);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format");

const parseIsoDayStart = (value: string) =>
  new Date(`${value}T00:00:00.000Z`);

const isValidDate = (value: Date) => Number.isFinite(value.getTime());

const MAX_CUSTOM_RANGE_DAYS = 365;

export const analyticsOverviewQuerySchema = z
  .object({
    range: analyticsRangeSchema.default("30d"),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasStart = Boolean(value.startDate);
    const hasEnd = Boolean(value.endDate);

    if (hasStart !== hasEnd) {
      if (!hasStart) {
        ctx.addIssue({
          code: "custom",
          path: ["startDate"],
          message: "startDate is required when endDate is provided",
        });
      }

      if (!hasEnd) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: "endDate is required when startDate is provided",
        });
      }
      return;
    }

    if (!hasStart || !hasEnd) {
      return;
    }

    const start = parseIsoDayStart(value.startDate!);
    const end = parseIsoDayStart(value.endDate!);

    if (!isValidDate(start)) {
      ctx.addIssue({
        code: "custom",
        path: ["startDate"],
        message: "startDate must be a valid date",
      });
    }

    if (!isValidDate(end)) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "endDate must be a valid date",
      });
    }

    if (!isValidDate(start) || !isValidDate(end)) {
      return;
    }

    if (end.getTime() < start.getTime()) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "endDate must be on or after startDate",
      });
      return;
    }

    const oneDayMs = 24 * 60 * 60 * 1000;
    const inclusiveDays = Math.floor((end.getTime() - start.getTime()) / oneDayMs) + 1;

    if (inclusiveDays > MAX_CUSTOM_RANGE_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: `Custom range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days`,
      });
    }
  });

export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;
export type AnalyticsOverviewQueryInput = z.infer<
  typeof analyticsOverviewQuerySchema
>;
