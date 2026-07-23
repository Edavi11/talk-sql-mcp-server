import { describe, it, expect, afterAll } from "vitest";
import { testConnection, listDatabases, listSchemas } from "../../tools/database-tools.js";
import { executeSQL, selectData } from "../../tools/query-tools.js";
import { createTable, createRelation } from "../../tools/ddl-tools.js";
import { createTrigger } from "../../tools/trigger-tools.js";
import { exportErDiagram } from "../../tools/diagram-tools.js";
import { withGate } from "../../services/tool-gate.js";
import { evictAll } from "../../services/pool-cache.js";
import { CONN, uniqueTableName } from "./setup.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const gatedExecuteSQL = withGate("db_query", { kind: "dynamic-sql" }, executeSQL);

afterAll(async () => {
  await evictAll();
});

describe("CockroachDB connectivity", () => {
  it("db_ping succeeds and reports the CockroachDB version", async () => {
    const result = await testConnection({ connection_string: CONN.cockroachdb, response_format: "json" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.server_version.toLowerCase()).toContain("cockroachdb");
  });

  it("db_list_databases returns at least defaultdb", async () => {
    const result = await listDatabases({ connection_string: CONN.cockroachdb, response_format: "json" });
    const parsed = result.structuredContent as { databases: Array<{ name: string }> };
    const names = parsed.databases.map((d) => d.name);
    expect(names).toContain("defaultdb");
  });
});

describe("CockroachDB DDL + DML", () => {
  it("creates a table, inserts, selects, and paginates", async () => {
    const table = uniqueTableName("crdb_users");

    const createResult = await createTable({
      connection_string: CONN.cockroachdb,
      table,
      columns: [
        { name: "id", type: "INT", primary_key: true, auto_increment: true },
        { name: "name", type: "TEXT" },
      ],
      response_format: "markdown",
    });
    expect(createResult.content[0].text).toContain("created successfully");

    await executeSQL({
      connection_string: CONN.cockroachdb,
      query: `INSERT INTO ${table} (name) VALUES ('alice'), ('bob')`,
      confirm: false,
      response_format: "markdown",
    });

    const selectResult = await selectData({
      connection_string: CONN.cockroachdb,
      table,
      limit: 10,
      offset: 0,
      response_format: "json",
    });
    const parsed = JSON.parse(selectResult.content[0].text);
    expect(parsed.count).toBe(2);
  });

  it("creates a foreign key relation between two tables", async () => {
    const parent = uniqueTableName("crdb_parent");
    const child = uniqueTableName("crdb_child");

    await createTable({
      connection_string: CONN.cockroachdb,
      table: parent,
      columns: [{ name: "id", type: "INT", primary_key: true }],
      response_format: "markdown",
    });
    await createTable({
      connection_string: CONN.cockroachdb,
      table: child,
      columns: [{ name: "id", type: "INT", primary_key: true }, { name: "parent_id", type: "INT" }],
      response_format: "markdown",
    });

    const result = await createRelation({
      connection_string: CONN.cockroachdb,
      table: child,
      foreign_keys: [{ column: "parent_id", references_table: parent, references_column: "id" }],
      response_format: "json",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });
});

describe("CockroachDB triggers (requires v24.1+)", () => {
  it("creates a BEFORE INSERT trigger using the CockroachDB-specific PL/pgSQL path", async () => {
    const table = uniqueTableName("crdb_trig");
    await createTable({
      connection_string: CONN.cockroachdb,
      table,
      columns: [{ name: "id", type: "INT", primary_key: true }, { name: "audit", type: "TEXT" }],
      response_format: "markdown",
    });

    const result = await createTrigger({
      connection_string: CONN.cockroachdb,
      table,
      trigger_name: `${table}_audit_trigger`,
      timing: "BEFORE",
      event: "INSERT",
      procedure: "NEW.audit := 'created';",
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("created successfully");

    await executeSQL({
      connection_string: CONN.cockroachdb,
      query: `INSERT INTO ${table} (id) VALUES (1)`,
      confirm: false,
      response_format: "markdown",
    });

    const verify = await selectData({
      connection_string: CONN.cockroachdb,
      table,
      limit: 10,
      offset: 0,
      response_format: "json",
    });
    const parsed = JSON.parse(verify.content[0].text);
    expect(parsed.data[0].audit).toBe("created");
  });
});

describe("CockroachDB schema introspection + ER diagram export", () => {
  it("exports an ER diagram covering CockroachDB tables and relations", async () => {
    const table = uniqueTableName("crdb_diagram");
    await createTable({
      connection_string: CONN.cockroachdb,
      table,
      columns: [{ name: "id", type: "INT", primary_key: true }],
      response_format: "markdown",
    });

    const outputPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "talk-sql-crdb-")), "schema.md");
    const result = await exportErDiagram({
      connection_string: CONN.cockroachdb,
      format: "mermaid",
      output_path: outputPath,
      response_format: "json",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.tables).toBeGreaterThan(0);
  });

  it("db_list_tables includes newly created CockroachDB tables", async () => {
    const table = uniqueTableName("crdb_listed");
    await createTable({
      connection_string: CONN.cockroachdb,
      table,
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });

    const result = await listSchemas({ connection_string: CONN.cockroachdb, response_format: "json" });
    const parsed = JSON.parse(result.content[0].text);
    const tableNames = parsed.schemas.flatMap((s: { tables: Array<{ table_name: string }> }) => s.tables.map(t => t.table_name));
    expect(tableNames).toContain(table);
  });
});

describe("CockroachDB EXPLAIN + gating", () => {
  it("EXPLAIN returns the query plan as rows", async () => {
    const table = uniqueTableName("crdb_explain");
    await createTable({
      connection_string: CONN.cockroachdb,
      table,
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });

    const result = await executeSQL({
      connection_string: CONN.cockroachdb,
      query: `EXPLAIN SELECT * FROM ${table}`,
      confirm: false,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("Query Results");
    expect(result.content[0].text).not.toContain("Rows affected");
  });

  it("blocks DROP TABLE pending confirm, executes with confirm:true", async () => {
    const table = uniqueTableName("crdb_drop");
    await createTable({
      connection_string: CONN.cockroachdb,
      table,
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });

    const blocked = await gatedExecuteSQL({
      connection_string: CONN.cockroachdb,
      query: `DROP TABLE ${table}`,
      confirm: false,
      response_format: "markdown",
    });
    expect(blocked.structuredContent).toMatchObject({ blocked: true, reason: "destructive_confirmation_required" });

    const confirmed = await gatedExecuteSQL({
      connection_string: CONN.cockroachdb,
      query: `DROP TABLE ${table}`,
      confirm: true,
      response_format: "markdown",
    });
    expect(confirmed.content[0].text).not.toContain("blocked");
  });
});
