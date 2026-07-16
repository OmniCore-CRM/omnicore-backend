import { Redis } from "ioredis";
import { env } from "./env.js";

let _client: Redis | null = null;

if (env.REDIS_URL) {
  _client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableReadyCheck: true,
    retryStrategy(times: number) {
      if (times > 10) return null;
      return Math.min(times * 200, 3_000);
    },
    commandTimeout: 200,
  });

  // Suppress unhandled-rejection noise; health is tracked via client.status.
  _client.on("error", () => {});

  // Non-blocking initial connection — failures are caught by the error event.
  void _client.connect().catch(() => {});
}

/**
 * Returns the configured Redis client, or null if REDIS_URL is not set.
 * Callers must check `client.status === "ready"` before issuing commands.
 */
export const getRedisClient = (): Redis | null => _client;
