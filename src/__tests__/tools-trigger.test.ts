import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTrigger } from "../tools/trigger-tools.js";
import { DatabaseType } from "../types.js";

vi.mock("../services/connection-manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/connection-manager.js")>();
  return {
    ...actual,
    createConnectionPool: vi.fn(),
  };
});

vi.mock("../services/query-executor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/query-executor.js")>();
  return {
    ...actual,
    executeQuery: vi.fn(),
  };
});

import { createConnectionPool } from "../services/connection-manager.js";
import { executeQuery } from "../services/query-executor.js";
import { resetPoolCacheForTests } from "../services/pool-cache.js";

const mockClose = vi.fn();
function mockPool(type: DatabaseType) {
  return { type, pool: {}, close: mockClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClose.mockResolvedValue(undefined);
  resetPoolCacheForTests();
});

describe("createTrigger", () => {
  const base = {
    table: "orders",
    trigger_name: "trg_orders_audit",
    timing: "AFTER" as const,
    event: "INSERT" as const,
    procedure: "SET NEW.updated_at = NOW();",
  };

  it("creates a MySQL trigger and returns markdown", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.MYSQL));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createTrigger({ ...base, connection_string: "mysql://u:p@h/db", response_format: "markdown" });

    expect(result.content[0].text).toContain("trg_orders_audit");
    expect(result.content[0].text).toContain("orders");
  });

  it("creates a MySQL trigger and returns JSON", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.MYSQL));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createTrigger({ ...base, connection_string: "mysql://u:p@h/db", response_format: "json" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.trigger_name).toBe("trg_orders_audit");
    expect(parsed.timing).toBe("AFTER");
    expect(parsed.event).toBe("INSERT");
  });

  it("creates a PostgreSQL trigger (multi-statement)", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createTrigger({
      ...base,
      connection_string: "postgresql://u:p@h/db",
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    // PostgreSQL generates function + trigger split by ;
    expect(vi.mocked(executeQuery)).toHaveBeenCalled();
    expect(parsed.query).toContain("CREATE OR REPLACE FUNCTION");
    expect(parsed.query).toContain("CREATE TRIGGER");
  });

  it("creates a SQL Server trigger with BEFORE -> INSTEAD OF", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.SQLSERVER));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createTrigger({
      ...base,
      timing: "BEFORE",
      connection_string: "mssql://u:p@h/db",
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.query).toContain("INSTEAD OF");
  });

  it("creates a SQLite trigger", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.SQLITE));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createTrigger({
      ...base,
      connection_string: "sqlite://test.db",
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it("creates trigger with schema prefix", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createTrigger({
      ...base,
      schema: "public",
      connection_string: "postgresql://u:p@h/db",
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.table).toBe("public.orders");
  });

  it("creates DELETE trigger with AFTER timing returning OLD", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createTrigger({
      ...base,
      event: "DELETE",
      connection_string: "postgresql://u:p@h/db",
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.query).toContain("OLD");
  });

  it("returns error message on failure", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.MYSQL));
    vi.mocked(executeQuery).mockRejectedValue(new Error("trigger already exists"));

    const result = await createTrigger({
      ...base,
      connection_string: "mysql://u:p@h/db",
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("Error creating trigger");
    expect(result.content[0].text).toContain("trigger already exists");
  });

  it("does not close the pool on error (pool lifecycle is owned by the TTL cache)", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.MYSQL));
    vi.mocked(executeQuery).mockRejectedValue(new Error("fail"));

    const result = await createTrigger({ ...base, connection_string: "mysql://u:p@h/db", response_format: "markdown" });

    expect(mockClose).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("Error creating trigger");
  });
});
