import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeSQL, selectData } from "../tools/query-tools.js";
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
function mockPool(type: DatabaseType = DatabaseType.POSTGRESQL) {
  return { type, pool: {}, close: mockClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPoolCacheForTests();
  mockClose.mockResolvedValue(undefined);
});

// ─── executeSQL ───────────────────────────────────────────────────────────────
describe("executeSQL", () => {
  it("returns markdown for SELECT query", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery).mockResolvedValue({
      rows: [{ id: 1, name: "Alice" }],
      rowCount: 1,
      columns: ["id", "name"],
    });

    const result = await executeSQL({
      connection_string: "postgresql://u:p@h/db",
      query: "SELECT * FROM users",
      confirm: false,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("Query Results");
    expect(result.content[0].text).toContain("**Rows returned:**");
  });

  it("returns JSON for SELECT query", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery).mockResolvedValue({
      rows: [{ id: 1 }],
      rowCount: 1,
      columns: ["id"],
    });

    const result = await executeSQL({
      connection_string: "postgresql://u:p@h/db",
      query: "SELECT * FROM users",
      confirm: false,
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rowCount).toBe(1);
    expect(parsed.columns).toEqual(["id"]);
    expect(result.structuredContent).toBeDefined();
  });

  it("returns markdown for DML query", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 3, columns: [] });

    const result = await executeSQL({
      connection_string: "postgresql://u:p@h/db",
      query: "UPDATE users SET active = true",
      confirm: true,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("Rows affected: 3");
  });

  it("returns JSON for DML query", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 2, columns: [] });

    const result = await executeSQL({
      connection_string: "postgresql://u:p@h/db",
      query: "DELETE FROM logs WHERE old = true",
      confirm: false,
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.rowCount).toBe(2);
    expect(result.structuredContent).toBeDefined();
  });

  it("returns connection error hint on ECONNREFUSED", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery).mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await executeSQL({
      connection_string: "postgresql://u:p@h/db",
      query: "SELECT 1",
      confirm: false,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("db_ping");
  });

  it("returns syntax error hint", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery).mockRejectedValue(new Error("syntax error near SELECT"));

    const result = await executeSQL({
      connection_string: "postgresql://u:p@h/db",
      query: "SELCT 1",
      confirm: false,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("syntax error");
  });

  it("returns table not found hint", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery).mockRejectedValue(new Error("table does not exist"));

    const result = await executeSQL({
      connection_string: "postgresql://u:p@h/db",
      query: "SELECT * FROM ghost",
      confirm: false,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("db_list_tables");
  });

  it("returns permission error hint", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery).mockRejectedValue(new Error("permission denied"));

    const result = await executeSQL({
      connection_string: "postgresql://u:p@h/db",
      query: "DROP TABLE users",
      confirm: true,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("privileges");
  });

  it("returns duplicate/unique constraint hint", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery).mockRejectedValue(new Error("duplicate key value violates unique constraint"));

    const result = await executeSQL({
      connection_string: "postgresql://u:p@h/db",
      query: "INSERT INTO users VALUES (1)",
      confirm: false,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("unique constraint");
  });

  it("returns connection/socket hint", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery).mockRejectedValue(new Error("socket hang up"));

    const result = await executeSQL({
      connection_string: "postgresql://u:p@h/db",
      query: "SELECT 1",
      confirm: false,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("db_ping");
  });

  it("does not close the pool on error (pool lifecycle is owned by the TTL cache)", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery).mockRejectedValue(new Error("fail"));

    const result = await executeSQL({ connection_string: "postgresql://u:p@h/db", query: "SELECT 1", confirm: false, response_format: "markdown" });

    expect(mockClose).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("Error executing query");
  });
});

// ─── selectData ───────────────────────────────────────────────────────────────
describe("selectData", () => {
  it("returns markdown with paginated results", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery)
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2, columns: ["id"] })
      .mockResolvedValueOnce({ rows: [{ total: 10 }], rowCount: 1, columns: ["total"] });

    const result = await selectData({
      connection_string: "postgresql://u:p@h/db",
      table: "users",
      limit: 2,
      offset: 0,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("users");
    expect(result.content[0].text).toContain("**Total rows:**");
  });

  it("returns JSON with pagination metadata", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery)
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1, columns: ["id"] })
      .mockResolvedValueOnce({ rows: [{ total: 5 }], rowCount: 1, columns: ["total"] });

    const result = await selectData({
      connection_string: "postgresql://u:p@h/db",
      table: "users",
      limit: 1,
      offset: 0,
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.total).toBe(5);
    expect(parsed.has_more).toBe(true);
    expect(parsed.next_offset).toBe(1);
    expect(result.structuredContent).toBeDefined();
  });

  it("selects specific columns", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery)
      .mockResolvedValueOnce({ rows: [{ name: "Alice" }], rowCount: 1, columns: ["name"] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }], rowCount: 1, columns: ["total"] });

    const result = await selectData({
      connection_string: "postgresql://u:p@h/db",
      table: "users",
      columns: ["name"],
      limit: 10,
      offset: 0,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("name");
  });

  it("applies WHERE clause filter", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery)
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1, columns: ["id"] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }], rowCount: 1, columns: ["total"] });

    const result = await selectData({
      connection_string: "postgresql://u:p@h/db",
      table: "users",
      where: "active = true",
      limit: 10,
      offset: 0,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("users");
  });

  it("uses SQL Server OFFSET/FETCH syntax", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.SQLSERVER));
    vi.mocked(executeQuery)
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1, columns: ["id"] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }], rowCount: 1, columns: ["total"] });

    await selectData({
      connection_string: "mssql://u:p@h/db",
      table: "users",
      limit: 10,
      offset: 0,
      response_format: "markdown",
    });

    const firstCall = vi.mocked(executeQuery).mock.calls[0][0];
    expect((firstCall as { query: string }).query).toContain("FETCH NEXT");
  });

  it("truncates response when over CHARACTER_LIMIT", async () => {
    const bigRows = Array.from({ length: 100 }, (_, i) => ({ id: i, data: "x".repeat(500) }));
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery)
      .mockResolvedValueOnce({ rows: bigRows, rowCount: 100, columns: ["id", "data"] })
      .mockResolvedValueOnce({ rows: [{ total: 100 }], rowCount: 1, columns: ["total"] });

    const result = await selectData({
      connection_string: "postgresql://u:p@h/db",
      table: "logs",
      limit: 100,
      offset: 0,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("truncated");
  });

  it("handles count query failure gracefully (returns -1)", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery)
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1, columns: ["id"] })
      .mockRejectedValueOnce(new Error("count not supported"));

    const result = await selectData({
      connection_string: "postgresql://u:p@h/db",
      table: "users",
      limit: 10,
      offset: 0,
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total).toBeUndefined();
  });

  it("uses schema.table notation", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery)
      .mockResolvedValueOnce({ rows: [], rowCount: 0, columns: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }], rowCount: 1, columns: ["total"] });

    const result = await selectData({
      connection_string: "postgresql://u:p@h/db",
      schema: "public",
      table: "users",
      limit: 10,
      offset: 0,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("public.users");
  });

  it("returns connection error hint", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery).mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await selectData({
      connection_string: "postgresql://u:p@h/db",
      table: "users",
      limit: 10,
      offset: 0,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("db_ping");
  });

  it("returns table not found hint", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    vi.mocked(executeQuery).mockRejectedValue(new Error("table does not exist"));

    const result = await selectData({
      connection_string: "postgresql://u:p@h/db",
      table: "ghost",
      limit: 10,
      offset: 0,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("db_list_tables");
  });

  it("returns column error hint", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());
    // "column" + "unknown" triggers the column hint (before "does not exist" which triggers table hint)
    vi.mocked(executeQuery).mockRejectedValue(new Error("column bad_col unknown"));

    const result = await selectData({
      connection_string: "postgresql://u:p@h/db",
      table: "users",
      columns: ["bad_col"],
      limit: 10,
      offset: 0,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("columns parameter");
  });

  it("rejects an invalid WHERE clause before reaching the database", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool());

    const result = await selectData({
      connection_string: "postgresql://u:p@h/db",
      table: "users",
      where: "bad syntax ===",
      limit: 10,
      offset: 0,
      response_format: "markdown",
    });

    expect(executeQuery).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("where clause");
  });
});
