import { PrismaClient } from "@prisma/client";
import { recordPrismaQuery, isApiProfilingEnabled } from "@/core/profiling/request-profiler.js";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
};

const isDevelopmentLike =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
const enableApiProfiling = isApiProfilingEnabled();

const prismaLogConfig = isDevelopmentLike
    ? ["query" as const, "error" as const, "warn" as const]
    : ["error" as const];

const basePrisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    // Query logging is useful locally but too expensive/noisy in production.
    log: prismaLogConfig,
  });

export const prisma = (enableApiProfiling
  ? basePrisma.$extends({
      query: {
        $allOperations({ model, operation, args, query }) {
          const startedAt = Date.now();
          return query(args).finally(() => {
            recordPrismaQuery(`${model ?? "Raw"}.${operation}`, Date.now() - startedAt);
          });
        },
      },
    })
  : basePrisma) as PrismaClient;

if (isDevelopmentLike) {
  globalForPrisma.prisma = basePrisma;
}