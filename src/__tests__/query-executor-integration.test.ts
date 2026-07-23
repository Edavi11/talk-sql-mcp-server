import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeQuery, formatResultsAsMarkdown, formatResultsAsJSON } from "../services/query-executor.js";
import { DatabaseType } from "../types.js";
import type { ConnectionPool } from "../services/connection-manager.js";

// ─── PostgreSQL mock ──────────────────────────────────────────────────────────
const pgQuery = vi.fn();
const pgPool = { query: pgQuery };

// ─── MySQL mock ───────────────────────────────────────────────────────────────
const mysqlExecute = vi.fn();
const mysqlPool = { execute: mysqlExecute };

// ─── SQL Server mock ──────────────────────────────────────────────────────────
const mssqlQuery = vi.fn();
const mssqlRequest = vi.fn(() => ({ input: vi.fn(), query: mssqlQuery }));
const mssqlPool = { request: mssqlRequest };

// ─── SQLite mock ──────────────────────────────────────────────────────────────
const sqliteAll = vi.fn();
const sqliteRun = vi.fn();
const sqlitePrepare = vi.fn(() => ({ all: sqliteAll, run: sqliteRun, get: vi.fn(() => ({})) }));
const sqliteDb = { prepare: sqlitePrepare };

function makePool(type: DatabaseType, pool: unknown): ConnectionPool {
  return { type, pool, close: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── PostgreSQL ───────────────────────────────────────────────────────────────
describe("executeQuery - PostgreSQL", () => {
  it("returns rows and columns for SELECT", async () => {
    pgQuery.mockResolvedValue({
      rows: [{ id: 1, name: "Alice" }],
      rowCount: 1,
      fields: [{ name: "id" }, { name: "name" }],
    });

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.POSTGRESQL, pgPool),
      query: "SELECT * FROM users",
    });

    expect(result.rows).toEqual([{ id: 1, name: "Alice" }]);
    expect(result.rowCount).toBe(1);
    expect(result.columns).toEqual(["id", "name"]);
  });

  it("handles DML query (no rows)", async () => {
    pgQuery.mockResolvedValue({ rows: [], rowCount: 3, fields: [] });

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.POSTGRESQL, pgPool),
      query: "UPDATE users SET active = true",
    });

    expect(result.rowCount).toBe(3);
  });

  it("throws on PostgreSQL error", async () => {
    pgQuery.mockRejectedValue(new Error("relation does not exist"));

    await expect(executeQuery({
      connectionPool: makePool(DatabaseType.POSTGRESQL, pgPool),
      query: "SELECT * FROM nonexistent",
    })).rejects.toThrow("PostgreSQL query error: relation does not exist");
  });

  it("throws when query exceeds MAX_QUERY_LENGTH", async () => {
    await expect(executeQuery({
      connectionPool: makePool(DatabaseType.POSTGRESQL, pgPool),
      query: "a".repeat(100001),
    })).rejects.toThrow("Query exceeds maximum length");
  });
});

// ─── MySQL ────────────────────────────────────────────────────────────────────
describe("executeQuery - MySQL", () => {
  it("returns rows and columns for SELECT", async () => {
    const mockRow = Object.assign(Object.create({ constructor: { name: "RowDataPacket" } }), { id: 1, name: "Bob" });
    mysqlExecute.mockResolvedValue([
      [mockRow],
      [{ name: "id" }, { name: "name" }],
    ]);

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.MYSQL, mysqlPool),
      query: "SELECT * FROM users",
    });

    expect(result.rowCount).toBe(1);
    expect(result.columns).toEqual(["id", "name"]);
  });

  it("handles non-array rows result", async () => {
    mysqlExecute.mockResolvedValue([{ affectedRows: 2 }, []]);

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.MYSQL, mysqlPool),
      query: "DELETE FROM users WHERE id = 1",
    });

    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it("throws on MySQL error", async () => {
    mysqlExecute.mockRejectedValue(new Error("Table 'db.users' doesn't exist"));

    await expect(executeQuery({
      connectionPool: makePool(DatabaseType.MYSQL, mysqlPool),
      query: "SELECT * FROM users",
    })).rejects.toThrow("MySQL query error");
  });
});

// ─── SQL Server ───────────────────────────────────────────────────────────────
describe("executeQuery - SQL Server", () => {
  function makeMssqlPool(queryFn: ReturnType<typeof vi.fn>) {
    const inputFn = vi.fn();
    const req = vi.fn(() => ({ input: inputFn, query: queryFn }));
    return { pool: { request: req }, inputFn, req };
  }

  it("returns rows and columns for SELECT", async () => {
    const recordset = [{ id: 1 }];
    Object.assign(recordset, { columns: { id: {}, name: {} } });
    const queryFn = vi.fn().mockResolvedValue({ recordset, rowsAffected: [1] });
    const { pool } = makeMssqlPool(queryFn);

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.SQLSERVER, pool),
      query: "SELECT * FROM users",
    });

    expect(result.rows[0]).toMatchObject({ id: 1 });
    expect(result.columns).toEqual(["id", "name"]);
  });

  it("handles DML result with no recordset columns", async () => {
    const recordset: unknown[] = [];
    Object.assign(recordset, { columns: null });
    const queryFn = vi.fn().mockResolvedValue({ recordset, rowsAffected: [5] });
    const { pool } = makeMssqlPool(queryFn);

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.SQLSERVER, pool),
      query: "DELETE FROM logs",
    });

    expect(result.rowCount).toBe(5);
    expect(result.columns).toEqual([]);
  });

  it("throws on SQL Server error", async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error("Invalid column name"));
    const { pool } = makeMssqlPool(queryFn);

    await expect(executeQuery({
      connectionPool: makePool(DatabaseType.SQLSERVER, pool),
      query: "SELECT bad_col FROM users",
    })).rejects.toThrow("SQL Server query error");
  });

  it("executes with params", async () => {
    const recordset = [{ id: 1 }];
    Object.assign(recordset, { columns: { id: {} } });
    const queryFn = vi.fn().mockResolvedValue({ recordset, rowsAffected: [1] });
    const { pool, inputFn } = makeMssqlPool(queryFn);

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.SQLSERVER, pool),
      query: "SELECT * FROM users WHERE id = @param0",
      params: [1],
    });

    expect(result.rows[0]).toMatchObject({ id: 1 });
    expect(inputFn).toHaveBeenCalledWith("param0", 1);
  });
});

// ─── SQL Server batch (GO statements) ────────────────────────────────────────
describe("executeQuery - SQL Server GO batches", () => {
  it("executes multiple batches separated by GO", async () => {
    const recordset: unknown[] = [];
    Object.assign(recordset, { columns: {} });
    const queryFn = vi.fn().mockResolvedValue({ recordset, rowsAffected: [1] });
    const req = vi.fn(() => ({ input: vi.fn(), query: queryFn }));

    await executeQuery({
      connectionPool: makePool(DatabaseType.SQLSERVER, { request: req }),
      query: "CREATE TABLE t1 (id INT)\nGO\nCREATE TABLE t2 (id INT)",
    });

    // req is called once per batch (2 batches total)
    expect(req).toHaveBeenCalledTimes(2);
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("skips USE statements in batch", async () => {
    const recordset: unknown[] = [];
    Object.assign(recordset, { columns: {} });
    const queryFn = vi.fn().mockResolvedValue({ recordset, rowsAffected: [1] });
    const req = vi.fn(() => ({ input: vi.fn(), query: queryFn }));

    await executeQuery({
      connectionPool: makePool(DatabaseType.SQLSERVER, { request: req }),
      query: "USE mydb\nGO\nSELECT 1",
    });

    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("returns last SELECT result in batch", async () => {
    const emptyRecordset: unknown[] = [];
    Object.assign(emptyRecordset, { columns: {} });
    const selectRecordset = [{ id: 42 }];
    Object.assign(selectRecordset, { columns: { id: {} } });

    let callCount = 0;
    const req = vi.fn(() => {
      callCount++;
      const queryFn = callCount === 1
        ? vi.fn().mockResolvedValue({ recordset: emptyRecordset, rowsAffected: [1] })
        : vi.fn().mockResolvedValue({ recordset: selectRecordset, rowsAffected: [1] });
      return { input: vi.fn(), query: queryFn };
    });

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.SQLSERVER, { request: req }),
      query: "INSERT INTO t (id) VALUES (1)\nGO\nSELECT * FROM t",
    });

    expect(result.rows[0]).toMatchObject({ id: 42 });
  });

  it("throws with failed batch info on error", async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error("syntax error"));
    const req = vi.fn(() => ({ input: vi.fn(), query: queryFn }));

    await expect(executeQuery({
      connectionPool: makePool(DatabaseType.SQLSERVER, { request: req }),
      query: "INVALID SQL\nGO\nSELECT 1",
    })).rejects.toThrow("Error executing batch");
  });
});

// ─── SQLite ───────────────────────────────────────────────────────────────────
describe("executeQuery - SQLite", () => {
  it("returns rows and columns for SELECT", async () => {
    sqliteAll.mockReturnValue([{ id: 1, name: "Alice" }]);

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.SQLITE, sqliteDb),
      query: "SELECT * FROM users",
    });

    expect(result.rows).toEqual([{ id: 1, name: "Alice" }]);
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rowCount).toBe(1);
  });

  it("returns empty columns when SELECT returns no rows", async () => {
    sqliteAll.mockReturnValue([]);

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.SQLITE, sqliteDb),
      query: "SELECT * FROM users WHERE 1=0",
    });

    expect(result.rows).toEqual([]);
    expect(result.columns).toEqual([]);
  });

  it("handles non-SELECT queries (INSERT/UPDATE/DELETE)", async () => {
    sqliteRun.mockReturnValue({ changes: 3 });

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.SQLITE, sqliteDb),
      query: "DELETE FROM users WHERE active = 0",
    });

    expect(result.rowCount).toBe(3);
    expect(result.rows).toEqual([]);
  });

  it("throws on SQLite error", async () => {
    sqlitePrepare.mockImplementationOnce(() => { throw new Error("no such table: users"); });

    await expect(executeQuery({
      connectionPool: makePool(DatabaseType.SQLITE, sqliteDb),
      query: "SELECT * FROM users",
    })).rejects.toThrow("SQLite query error");
  });

  it("calls .all() (not .run()) for EXPLAIN, returning plan rows", async () => {
    sqliteAll.mockReturnValue([{ addr: 0, opcode: "Init" }]);

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.SQLITE, sqliteDb),
      query: "EXPLAIN SELECT * FROM users",
    });

    expect(sqliteAll).toHaveBeenCalled();
    expect(sqliteRun).not.toHaveBeenCalled();
    expect(result.rows).toEqual([{ addr: 0, opcode: "Init" }]);
  });

  it("calls .all() for EXPLAIN QUERY PLAN, returning plan rows", async () => {
    sqliteAll.mockReturnValue([{ id: 2, parent: 0, notused: 0, detail: "SCAN users" }]);

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.SQLITE, sqliteDb),
      query: "EXPLAIN QUERY PLAN SELECT * FROM users",
    });

    expect(sqliteAll).toHaveBeenCalled();
    expect(result.rows).toEqual([{ id: 2, parent: 0, notused: 0, detail: "SCAN users" }]);
  });

  it("calls .run() (not .all()) for ANALYZE, since SQLite does not return rows for it", async () => {
    sqliteRun.mockReturnValue({ changes: 0 });

    const result = await executeQuery({
      connectionPool: makePool(DatabaseType.SQLITE, sqliteDb),
      query: "ANALYZE users",
    });

    expect(sqliteRun).toHaveBeenCalled();
    expect(sqliteAll).not.toHaveBeenCalled();
    expect(result.rows).toEqual([]);
  });
});

// ─── Unsupported DB type ──────────────────────────────────────────────────────
describe("executeQuery - unsupported type", () => {
  it("throws for unsupported database type", async () => {
    await expect(executeQuery({
      connectionPool: makePool("unknown" as DatabaseType, {}),
      query: "SELECT 1",
    })).rejects.toThrow("Unsupported database type");
  });
});
