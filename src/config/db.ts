import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
};

const isDevelopmentLike =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    // Query logging is useful locally but too expensive/noisy in production.
    log: isDevelopmentLike ? ["query", "error", "warn"] : ["error"],
  });

if (isDevelopmentLike) {
  globalForPrisma.prisma = prisma;
}