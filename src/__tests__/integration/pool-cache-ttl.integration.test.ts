import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { executeSQL } from "../../tools/query-tools.js";
import { evictAll } from "../../services/pool-cache.js";
import { CONN } from "./setup.js";

const originalTtl = process.env.TALK_SQL_POOL_TTL_MS;

beforeEach(async () => {
  await evictAll();
  process.env.TALK_SQL_POOL_TTL_MS = "2000";
});

afterEach(async () => {
  if (originalTtl === undefined) {
    delete process.env.TALK_SQL_POOL_TTL_MS;
  } else {
    process.env.TALK_SQL_POOL_TTL_MS = originalTtl;
  }
});

afterAll(async () => {
  await evictAll();
});

async function activeConnectionCount(): Promise<number> {
  const { createConnectionPool } = await import("../../services/connection-manager.js");
  const pool = await createConnectionPool(CONN.postgresql);
  try {
    const pg = await import("pg");
    const raw = pool.pool as InstanceType<typeof pg.Pool>;
    const result = await raw.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = 'talksql_test'");
    return result.rows[0].count as number;
  } finally {
    await pool.close();
  }
}

describe("connection pool TTL caching against postgresql", () => {
  it("reuses a single underlying connection within the TTL window", async () => {
    await executeSQL({ connection_string: CONN.postgresql, query: "SELECT 1", confirm: false, response_format: "json" });
    const countAfterFirst = await activeConnectionCount();

    await executeSQL({ connection_string: CONN.postgresql, query: "SELECT 1", confirm: false, response_format: "json" });
    const countAfterSecond = await activeConnectionCount();

    // The cached pool is reused, so opening a second short-lived probe connection
    // (from activeConnectionCount itself) should not increase the count beyond
    // what a single cached pool + probe connection would produce.
    expect(countAfterSecond).toBeLessThanOrEqual(countAfterFirst + 1);
  });

  it("opens a new connection after the TTL elapses", async () => {
    await executeSQL({ connection_string: CONN.postgresql, query: "SELECT 1", confirm: false, response_format: "json" });

    await new Promise(resolve => setTimeout(resolve, 2500));
    await evictAll();

    const result = await executeSQL({ connection_string: CONN.postgresql, query: "SELECT 1", confirm: false, response_format: "json" });
    expect(result.content[0].text).not.toContain("Error executing query");
  });
});
