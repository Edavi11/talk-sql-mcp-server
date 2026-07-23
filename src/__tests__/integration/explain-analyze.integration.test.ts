import { describe, it, expect, afterAll } from "vitest";
import { executeSQL } from "../../tools/query-tools.js";
import { createTable } from "../../tools/ddl-tools.js";
import { evictAll } from "../../services/pool-cache.js";
import { CONN, newSqliteConnectionString, uniqueTableName } from "./setup.js";

afterAll(async () => {
  await evictAll();
});

describe("EXPLAIN against postgresql", () => {
  it("returns the query plan as rows, not a rowCount message", async () => {
    const table = uniqueTableName("explain_pg");
    await createTable({
      connection_string: CONN.postgresql,
      table,
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });

    const result = await executeSQL({
      connection_string: CONN.postgresql,
      query: `EXPLAIN SELECT * FROM ${table}`,
      confirm: false,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("Query Results");
    expect(result.content[0].text).not.toContain("Rows affected");
  });

  it("ANALYZE returns without requiring confirm and does not modify data", async () => {
    const table = uniqueTableName("analyze_pg");
    await createTable({
      connection_string: CONN.postgresql,
      table,
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });

    const result = await executeSQL({
      connection_string: CONN.postgresql,
      query: `ANALYZE ${table}`,
      confirm: false,
      response_format: "markdown",
    });

    expect(result.content[0].text).not.toContain("confirmation required");
  });
});

describe("EXPLAIN/ANALYZE against mysql", () => {
  it("EXPLAIN returns the query plan as rows", async () => {
    const table = uniqueTableName("explain_mysql");
    await createTable({
      connection_string: CONN.mysql,
      table,
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });

    const result = await executeSQL({
      connection_string: CONN.mysql,
      query: `EXPLAIN SELECT * FROM ${table}`,
      confirm: false,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("Query Results");
    expect(result.content[0].text).not.toContain("Rows affected");
  });

  it("ANALYZE TABLE returns a status report as rows without requiring confirm", async () => {
    const table = uniqueTableName("analyze_mysql");
    await createTable({
      connection_string: CONN.mysql,
      table,
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });

    const result = await executeSQL({
      connection_string: CONN.mysql,
      query: `ANALYZE TABLE ${table}`,
      confirm: false,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("Query Results");
    expect(result.content[0].text).not.toContain("confirmation required");
  });
});

describe("EXPLAIN against sqlite", () => {
  it("EXPLAIN QUERY PLAN returns plan rows (exercises the SQLite .all()-vs-.run() fix)", async () => {
    const connectionString = newSqliteConnectionString();
    const table = uniqueTableName("explain_sqlite");
    await createTable({
      connection_string: connectionString,
      table,
      columns: [{ name: "id", type: "INTEGER" }],
      response_format: "markdown",
    });

    const result = await executeSQL({
      connection_string: connectionString,
      query: `EXPLAIN QUERY PLAN SELECT * FROM ${table}`,
      confirm: false,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("Query Results");
    expect(result.content[0].text).not.toContain("Rows affected");
  });
});
