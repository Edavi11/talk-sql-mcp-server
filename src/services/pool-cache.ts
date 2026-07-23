/**
 * TTL-based cache of resolved connections (SSH tunnel + connection pool together).
 *
 * Keyed by pre-tunnel-resolution identity (connection_name or connection_string),
 * not by the post-rewrite connection string - this way a cache hit skips
 * resolveConnection() entirely, including opening a new SSH tunnel, rather than
 * only caching the pool while still tunneling on every call.
 */

import { createConnectionPool, ConnectionPool } from "./connection-manager.js";
import { resolveConnection } from "../constants.js";

interface CacheEntry {
  pool: ConnectionPool;
  cleanup: () => Promise<void>;
  connectionString: string;
  evictTimer: NodeJS.Timeout;
}

const cache = new Map<string, CacheEntry>();

function getTtlMs(): number {
  const raw = Number(process.env.TALK_SQL_POOL_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 60 * 1000;
}

function cacheKeyFor(params: { connection_string?: string; connection_name?: string }): string {
  return params.connection_name ?? params.connection_string ?? "__env_fallback__";
}

async function evict(key: string): Promise<void> {
  const entry = cache.get(key);
  if (!entry) return;
  cache.delete(key);
  await entry.pool.close();
  await entry.cleanup();
}

function scheduleEviction(key: string): NodeJS.Timeout {
  const timer = setTimeout(() => {
    evict(key).catch(() => {});
  }, getTtlMs());
  timer.unref?.();
  return timer;
}

/**
 * Resolves a connection (including SSH tunnel) and returns a pool, reusing a
 * cached pool + tunnel when one exists for the same connection identity.
 */
export async function getOrCreateResolvedPool(params: {
  connection_string?: string;
  connection_name?: string;
}): Promise<{ pool: ConnectionPool; connectionString: string }> {
  const key = cacheKeyFor(params);
  const existing = cache.get(key);

  if (existing) {
    clearTimeout(existing.evictTimer);
    existing.evictTimer = scheduleEviction(key);
    return { pool: existing.pool, connectionString: existing.connectionString };
  }

  const resolved = await resolveConnection(params);
  const pool = await createConnectionPool(resolved.connectionString);
  pool.cacheKey = key;

  const entry: CacheEntry = {
    pool,
    cleanup: resolved.cleanup,
    connectionString: resolved.connectionString,
    evictTimer: scheduleEviction(key)
  };
  cache.set(key, entry);

  return { pool, connectionString: resolved.connectionString };
}

/**
 * Closes and removes every cached pool/tunnel immediately, regardless of TTL.
 * Intended for graceful shutdown and test cleanup.
 */
export async function evictAll(): Promise<void> {
  const keys = Array.from(cache.keys());
  for (const key of keys) {
    const entry = cache.get(key);
    if (entry) clearTimeout(entry.evictTimer);
    await evict(key);
  }
}

/**
 * Clears the cache without closing pools/tunnels. Test-only escape hatch for
 * isolating cache state between test cases that reuse the same connection
 * identity against mocked pools.
 */
export function resetPoolCacheForTests(): void {
  for (const entry of cache.values()) {
    clearTimeout(entry.evictTimer);
  }
  cache.clear();
}
