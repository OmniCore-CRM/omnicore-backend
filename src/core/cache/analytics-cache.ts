import { env } from "@/config/env.js";
import { getRedisClient } from "@/config/redis.js";

// ---- TTL constants ----

/** Data is considered fresh for 30 s. Matches existing bucket-key granularity. */
const FRESH_TTL_MS = 30_000;
/** After the fresh window, the stale entry remains usable for another 90 s. */
const STALE_WINDOW_MS = 90_000;
/** Total Redis/memory TTL = fresh + stale. Redis auto-evicts after this. */
export const ANALYTICS_CACHE_TOTAL_TTL_MS = FRESH_TTL_MS + STALE_WINDOW_MS; // 120 s
/** Distributed lock TTL: covers the worst-case cold-path compute time (~20 s). */
export const ANALYTICS_CACHE_LOCK_TTL_MS = 22_000;

// ---- Key prefixes ----

const REDIS_KEY_PREFIX = "omnicore:analytics:v1:";
const REDIS_LOCK_PREFIX = "omnicore:analytics:lock:v1:";

// ---- Types ----

export type AnalyticsCacheEntry = {
  /** Epoch ms. Entry is fresh while Date.now() < freshUntil. */
  freshUntil: number;
  /** Serialized analytics overview value. Typed as unknown to avoid coupling. */
  value: unknown;
};

export interface AnalyticsCacheStore {
  get(keyHash: string): Promise<AnalyticsCacheEntry | null>;
  set(keyHash: string, entry: AnalyticsCacheEntry): Promise<void>;
  /** Atomically acquire a lock. Returns true if acquired, false otherwise. */
  acquireLock(keyHash: string): Promise<boolean>;
  releaseLock(keyHash: string): Promise<void>;
  readonly source: "redis" | "memory";
}

// ---- Redis implementation ----

class RedisAnalyticsCacheStore implements AnalyticsCacheStore {
  readonly source = "redis" as const;

  private isReady(): boolean {
    const client = getRedisClient();
    return client !== null && client.status === "ready";
  }

  async get(keyHash: string): Promise<AnalyticsCacheEntry | null> {
    if (!this.isReady()) return null;
    try {
      const raw = await getRedisClient()!.get(REDIS_KEY_PREFIX + keyHash);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AnalyticsCacheEntry;
      if (typeof parsed?.freshUntil !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async set(keyHash: string, entry: AnalyticsCacheEntry): Promise<void> {
    if (!this.isReady()) return;
    try {
      await getRedisClient()!.set(
        REDIS_KEY_PREFIX + keyHash,
        JSON.stringify(entry),
        "PX",
        ANALYTICS_CACHE_TOTAL_TTL_MS
      );
    } catch {
      // Gracefully ignore — the caller already has the uncached result.
    }
  }

  async acquireLock(keyHash: string): Promise<boolean> {
    if (!this.isReady()) return false;
    try {
      // SET key "1" PX lockTtlMs NX — atomic, returns "OK" or null.
      const result = await getRedisClient()!.set(
        REDIS_LOCK_PREFIX + keyHash,
        "1",
        "PX",
        ANALYTICS_CACHE_LOCK_TTL_MS,
        "NX"
      );
      return result === "OK";
    } catch {
      return false;
    }
  }

  async releaseLock(keyHash: string): Promise<void> {
    const client = getRedisClient();
    if (!client) return;
    try {
      await client.del(REDIS_LOCK_PREFIX + keyHash);
    } catch {
      // Lock will expire via TTL.
    }
  }
}

// ---- In-memory fallback ----

type MemEntry = AnalyticsCacheEntry & { expireAt: number };

class InMemoryAnalyticsCacheStore implements AnalyticsCacheStore {
  readonly source = "memory" as const;

  private readonly entries = new Map<string, MemEntry>();
  private readonly locks = new Map<string, number>(); // keyHash → expireAt epoch ms

  async get(keyHash: string): Promise<AnalyticsCacheEntry | null> {
    const entry = this.entries.get(keyHash);
    if (!entry) return null;
    if (entry.expireAt <= Date.now()) {
      this.entries.delete(keyHash);
      return null;
    }
    return { freshUntil: entry.freshUntil, value: entry.value };
  }

  async set(keyHash: string, entry: AnalyticsCacheEntry): Promise<void> {
    this.entries.set(keyHash, {
      freshUntil: entry.freshUntil,
      value: entry.value,
      expireAt: Date.now() + ANALYTICS_CACHE_TOTAL_TTL_MS,
    });
  }

  async acquireLock(keyHash: string): Promise<boolean> {
    const existing = this.locks.get(keyHash);
    if (existing !== undefined && existing > Date.now()) return false;
    this.locks.set(keyHash, Date.now() + ANALYTICS_CACHE_LOCK_TTL_MS);
    return true;
  }

  async releaseLock(keyHash: string): Promise<void> {
    this.locks.delete(keyHash);
  }
}

// ---- Factory ----

/**
 * Returns a RedisAnalyticsCacheStore when REDIS_URL is configured, otherwise
 * falls back to an in-memory store (same SWR semantics, single-process only).
 */
export function createAnalyticsCacheStore(): AnalyticsCacheStore {
  if (env.REDIS_URL) {
    return new RedisAnalyticsCacheStore();
  }
  return new InMemoryAnalyticsCacheStore();
}
