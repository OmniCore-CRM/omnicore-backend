import { z } from "zod";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

const paginationQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT),
});

export type PaginationParams = {
  cursor?: string;
  limit: number;
};

export type PaginatedResult<T> = {
  items: T[];
  nextCursor: string | null;
  total?: number;
};

export const parsePaginationQuery = (
  query: unknown
): PaginationParams => {
  return paginationQuerySchema.parse(query);
};

export const toPaginatedResult = <T extends { id: string }>(
  records: T[],
  limit: number
): PaginatedResult<T> => {
  const hasNextPage = records.length > limit;
  const items = hasNextPage ? records.slice(0, limit) : records;

  return {
    items,
    nextCursor: hasNextPage
      ? items[items.length - 1]?.id ?? null
      : null,
  };
};
