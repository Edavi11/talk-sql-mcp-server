import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTable, createRelation } from "../tools/ddl-tools.js";
import { DatabaseType } from "../types.js";

// Mock createConnectionPool and detectDatabaseType
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

const mockClose = vi.fn();
function mockPool(type: DatabaseType) {
  return { type, pool: {}, close: mockClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClose.mockResolvedValue(undefined);
});

// ─── createTable ──────────────────────────────────────────────────────────────
describe("createTable", () => {
  it("creates a table and returns markdown response", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createTable({
      connection_string: "postgresql://user:pass@localhost/db",
      table: "users",
      columns: [{ name: "id", type: "SERIAL", primary_key: true }],
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("users");
    expect(result.content[0].text).toContain("CREATE TABLE");
  });

  it("creates a table and returns JSON response", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createTable({
      connection_string: "postgresql://user:pass@localhost/db",
      table: "users",
      columns: [{ name: "id", type: "SERIAL", primary_key: true }],
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.table).toBe("users");
    expect(parsed.columns).toBe(1);
  });

  it("creates a table with schema prefix", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createTable({
      connection_string: "postgresql://user:pass@localhost/db",
      schema: "public",
      table: "orders",
      columns: [
        { name: "id", type: "SERIAL", primary_key: true },
        { name: "total", type: "DECIMAL(10,2)", nullable: false, default: "0" },
        { name: "note", type: "VARCHAR(255)", nullable: true, unique: true },
      ],
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.table).toBe("public.orders");
    expect(parsed.columns).toBe(3);
    expect(parsed.query).toContain("public.orders");
  });

  it("handles MySQL auto_increment column", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.MYSQL));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createTable({
      connection_string: "mysql://user:pass@localhost/db",
      table: "products",
      columns: [{ name: "id", type: "INT", auto_increment: true, primary_key: true }],
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.query).toContain("AUTO_INCREMENT");
  });

  it("handles SQL Server IDENTITY column", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.SQLSERVER));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createTable({
      connection_string: "mssql://user:pass@localhost/db",
      table: "products",
      columns: [{ name: "id", type: "INT", auto_increment: true, primary_key: true }],
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.query).toContain("IDENTITY");
  });

  it("handles SQLite INTEGER primary key for auto_increment", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.SQLITE));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createTable({
      connection_string: "sqlite://test.db",
      table: "items",
      columns: [{ name: "id", type: "INT", auto_increment: true, primary_key: true }],
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.query).toContain("INTEGER");
  });

  it("returns error message when executeQuery fails", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(executeQuery).mockRejectedValue(new Error("table already exists"));

    const result = await createTable({
      connection_string: "postgresql://user:pass@localhost/db",
      table: "users",
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("Error creating table");
    expect(result.content[0].text).toContain("table already exists");
  });

  it("closes connection pool even on error", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(executeQuery).mockRejectedValue(new Error("fail"));

    await createTable({
      connection_string: "postgresql://user:pass@localhost/db",
      table: "users",
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });

    expect(mockClose).toHaveBeenCalled();
  });
});

// ─── createRelation ───────────────────────────────────────────────────────────
describe("createRelation", () => {
  it("creates foreign keys and returns markdown response", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createRelation({
      connection_string: "postgresql://user:pass@localhost/db",
      table: "orders",
      foreign_keys: [{
        column: "user_id",
        references_table: "users",
        references_column: "id",
        on_delete: "CASCADE",
        on_update: "NO ACTION",
      }],
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("Created 1 of 1");
  });

  it("returns JSON response with created count", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createRelation({
      connection_string: "postgresql://user:pass@localhost/db",
      table: "orders",
      foreign_keys: [{
        column: "user_id",
        references_table: "users",
        references_column: "id",
      }],
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.foreign_keys_created).toBe(1);
    expect(parsed.total_foreign_keys).toBe(1);
  });

  it("continues on partial failure and reports count", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(executeQuery)
      .mockResolvedValueOnce({ rows: [], rowCount: 0, columns: [] })
      .mockRejectedValueOnce(new Error("column does not exist"));

    const result = await createRelation({
      connection_string: "postgresql://user:pass@localhost/db",
      table: "orders",
      foreign_keys: [
        { column: "user_id", references_table: "users", references_column: "id" },
        { column: "bad_col", references_table: "products", references_column: "id" },
      ],
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.foreign_keys_created).toBe(1);
    expect(parsed.total_foreign_keys).toBe(2);
    expect(parsed.success).toBe(false);
  });

  it("creates relation with schema prefix", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(executeQuery).mockResolvedValue({ rows: [], rowCount: 0, columns: [] });

    const result = await createRelation({
      connection_string: "postgresql://user:pass@localhost/db",
      schema: "dbo",
      table: "orders",
      foreign_keys: [{ column: "user_id", references_table: "users", references_column: "id" }],
      response_format: "json",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.table).toBe("dbo.orders");
  });

  it("throws when connection pool creation fails", async () => {
    vi.mocked(createConnectionPool).mockRejectedValue(new Error("connection refused"));

    // createConnectionPool is called outside try/catch in createRelation, so the error propagates
    await expect(createRelation({
      connection_string: "postgresql://user:pass@localhost/db",
      table: "orders",
      foreign_keys: [{ column: "user_id", references_table: "users", references_column: "id" }],
      response_format: "markdown",
    })).rejects.toThrow("connection refused");
  });
});
