import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseType } from "../types.js";

vi.mock("../services/connection-manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/connection-manager.js")>();
  return {
    ...actual,
    createConnectionPool: vi.fn(),
  };
});

vi.mock("../constants.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../constants.js")>();
  return {
    ...actual,
    resolveConnection: vi.fn(),
  };
});

import { createConnectionPool } from "../services/connection-manager.js";
import { resolveConnection } from "../constants.js";
import { getOrCreateResolvedPool, evictAll, resetPoolCacheForTests } from "../services/pool-cache.js";

function mockPool() {
  return { type: DatabaseType.POSTGRESQL, pool: {}, close: vi.fn().mockResolvedValue(undefined) };
}

function mockResolved(connectionString: string) {
  return { connectionString, cleanup: vi.fn().mockResolvedValue(undefined) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  resetPoolCacheForTests();
  delete process.env.TALK_SQL_POOL_TTL_MS;
});

afterEach(async () => {
  await evictAll();
  vi.useRealTimers();
});

describe("getOrCreateResolvedPool", () => {
  it("creates a pool on first call", async () => {
    vi.mocked(resolveConnection).mockResolvedValue(mockResolved("postgresql://u:p@h/db"));
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());

    const result = await getOrCreateResolvedPool({ connection_string: "postgresql://u:p@h/db" });

    expect(resolveConnection).toHaveBeenCalledTimes(1);
    expect(createConnectionPool).toHaveBeenCalledTimes(1);
    expect(result.connectionString).toBe("postgresql://u:p@h/db");
  });

  it("reuses the cached pool within the TTL window", async () => {
    process.env.TALK_SQL_POOL_TTL_MS = "5000";
    vi.mocked(resolveConnection).mockResolvedValue(mockResolved("postgresql://u:p@h/db"));
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());

    await getOrCreateResolvedPool({ connection_name: "local" });
    await getOrCreateResolvedPool({ connection_name: "local" });

    expect(resolveConnection).toHaveBeenCalledTimes(1);
    expect(createConnectionPool).toHaveBeenCalledTimes(1);
  });

  it("evicts (closes pool + tunnel) after the TTL elapses with no further use", async () => {
    process.env.TALK_SQL_POOL_TTL_MS = "1000";
    const resolved = mockResolved("postgresql://u:p@h/db");
    const pool = mockPool();
    vi.mocked(resolveConnection).mockResolvedValue(resolved);
    vi.mocked(createConnectionPool).mockResolvedValue(pool);

    await getOrCreateResolvedPool({ connection_name: "local" });

    await vi.advanceTimersByTimeAsync(1500);

    expect(pool.close).toHaveBeenCalledTimes(1);
    expect(resolved.cleanup).toHaveBeenCalledTimes(1);
  });

  it("creates a fresh pool after eviction", async () => {
    process.env.TALK_SQL_POOL_TTL_MS = "1000";
    vi.mocked(resolveConnection).mockResolvedValue(mockResolved("postgresql://u:p@h/db"));
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());

    await getOrCreateResolvedPool({ connection_name: "local" });
    await vi.advanceTimersByTimeAsync(1500);

    await getOrCreateResolvedPool({ connection_name: "local" });

    expect(createConnectionPool).toHaveBeenCalledTimes(2);
  });

  it("uses independent cache entries for different connection identities", async () => {
    process.env.TALK_SQL_POOL_TTL_MS = "5000";
    vi.mocked(resolveConnection)
      .mockResolvedValueOnce(mockResolved("postgresql://u:p@h/db1"))
      .mockResolvedValueOnce(mockResolved("postgresql://u:p@h/db2"));
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());

    await getOrCreateResolvedPool({ connection_name: "conn-a" });
    await getOrCreateResolvedPool({ connection_name: "conn-b" });

    expect(resolveConnection).toHaveBeenCalledTimes(2);
    expect(createConnectionPool).toHaveBeenCalledTimes(2);
  });

  it("resets the TTL timer on reuse (does not evict early)", async () => {
    process.env.TALK_SQL_POOL_TTL_MS = "1000";
    const resolved = mockResolved("postgresql://u:p@h/db");
    const pool = mockPool();
    vi.mocked(resolveConnection).mockResolvedValue(resolved);
    vi.mocked(createConnectionPool).mockResolvedValue(pool);

    await getOrCreateResolvedPool({ connection_name: "local" });
    await vi.advanceTimersByTimeAsync(700);
    await getOrCreateResolvedPool({ connection_name: "local" }); // resets the timer
    await vi.advanceTimersByTimeAsync(700);

    expect(pool.close).not.toHaveBeenCalled();
  });
});

describe("evictAll", () => {
  it("closes every cached entry immediately regardless of remaining TTL", async () => {
    process.env.TALK_SQL_POOL_TTL_MS = "60000";
    const resolvedA = mockResolved("postgresql://u:p@h/dbA");
    const poolA = mockPool();
    const resolvedB = mockResolved("postgresql://u:p@h/dbB");
    const poolB = mockPool();

    vi.mocked(resolveConnection)
      .mockResolvedValueOnce(resolvedA)
      .mockResolvedValueOnce(resolvedB);
    vi.mocked(createConnectionPool)
      .mockResolvedValueOnce(poolA)
      .mockResolvedValueOnce(poolB);

    await getOrCreateResolvedPool({ connection_name: "conn-a" });
    await getOrCreateResolvedPool({ connection_name: "conn-b" });

    await evictAll();

    expect(poolA.close).toHaveBeenCalledTimes(1);
    expect(resolvedA.cleanup).toHaveBeenCalledTimes(1);
    expect(poolB.close).toHaveBeenCalledTimes(1);
    expect(resolvedB.cleanup).toHaveBeenCalledTimes(1);
  });
});
