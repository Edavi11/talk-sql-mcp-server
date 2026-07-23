import { describe, it, expect, beforeEach, afterAll, afterEach } from "vitest";
import { executeSQL } from "../../tools/query-tools.js";
import { createTable } from "../../tools/ddl-tools.js";
import { withGate } from "../../services/tool-gate.js";
import { evictAll } from "../../services/pool-cache.js";
import { CONN, newSqliteConnectionString, uniqueTableName } from "./setup.js";

const gatedExecuteSQL = withGate("db_query", { kind: "dynamic-sql" }, executeSQL);
const gatedCreateTable = withGate("db_create_table", { kind: "always-write" }, createTable);

const originalReadOnly = process.env.TALK_SQL_READONLY;

beforeEach(() => {
  delete process.env.TALK_SQL_READONLY;
});

afterEach(() => {
  if (originalReadOnly === undefined) {
    delete process.env.TALK_SQL_READONLY;
  } else {
    process.env.TALK_SQL_READONLY = originalReadOnly;
  }
});

afterAll(async () => {
  await evictAll();
});

describe.each([
  ["postgresql", CONN.postgresql],
  ["mysql", CONN.mysql],
  ["mssql", CONN.mssql],
])("read-only mode against %s", (_label, connectionString) => {
  it("allows SELECT and blocks INSERT/CREATE TABLE when TALK_SQL_READONLY=true", async () => {
    const table = uniqueTableName("ro_test");

    // sanity: create table while NOT in read-only mode
    const createResult = await gatedCreateTable({
      connection_string: connectionString,
      table,
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });
    expect(createResult.content[0].text).toContain("created successfully");

    process.env.TALK_SQL_READONLY = "true";

    const selectResult = await gatedExecuteSQL({
      connection_string: connectionString,
      query: `SELECT * FROM ${table}`,
      confirm: false,
      response_format: "markdown",
    });
    expect(selectResult.content[0].text).not.toContain("read-only mode");

    const insertResult = await gatedExecuteSQL({
      connection_string: connectionString,
      query: `INSERT INTO ${table} (id) VALUES (1)`,
      confirm: false,
      response_format: "markdown",
    });
    expect(insertResult.content[0].text).toContain("read-only mode");
    expect(insertResult.structuredContent).toMatchObject({ blocked: true, reason: "readonly_mode" });

    const createBlockedResult = await gatedCreateTable({
      connection_string: connectionString,
      table: uniqueTableName("ro_blocked"),
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });
    expect(createBlockedResult.content[0].text).toContain("read-only mode");
  });
});

describe("read-only mode against sqlite", () => {
  it("blocks INSERT when TALK_SQL_READONLY=true", async () => {
    const connectionString = newSqliteConnectionString();
    const table = uniqueTableName("ro_sqlite");

    await gatedCreateTable({
      connection_string: connectionString,
      table,
      columns: [{ name: "id", type: "INTEGER" }],
      response_format: "markdown",
    });

    process.env.TALK_SQL_READONLY = "true";

    const insertResult = await gatedExecuteSQL({
      connection_string: connectionString,
      query: `INSERT INTO ${table} (id) VALUES (1)`,
      confirm: false,
      response_format: "markdown",
    });

    expect(insertResult.content[0].text).toContain("read-only mode");
  });
});
