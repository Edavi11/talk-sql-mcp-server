import { describe, it, expect, afterAll } from "vitest";
import { executeSQL } from "../../tools/query-tools.js";
import { createTable } from "../../tools/ddl-tools.js";
import { withGate } from "../../services/tool-gate.js";
import { evictAll } from "../../services/pool-cache.js";
import { CONN, uniqueTableName } from "./setup.js";

const gatedExecuteSQL = withGate("db_query", { kind: "dynamic-sql" }, executeSQL);

afterAll(async () => {
  await evictAll();
});

describe("confirm=true gating against mysql", () => {
  it("blocks DELETE without WHERE until confirm:true is passed", async () => {
    const table = uniqueTableName("confirm_delete");
    await createTable({
      connection_string: CONN.mysql,
      table,
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });
    await executeSQL({ connection_string: CONN.mysql, query: `INSERT INTO ${table} (id) VALUES (1)`, confirm: false, response_format: "markdown" });

    const blocked = await gatedExecuteSQL({
      connection_string: CONN.mysql,
      query: `DELETE FROM ${table}`,
      confirm: false,
      response_format: "markdown",
    });
    expect(blocked.structuredContent).toMatchObject({ blocked: true, reason: "destructive_confirmation_required" });

    const stillThere = await executeSQL({ connection_string: CONN.mysql, query: `SELECT * FROM ${table}`, confirm: false, response_format: "json" });
    const parsedStillThere = JSON.parse(stillThere.content[0].text);
    expect(parsedStillThere.rowCount).toBe(1);

    const confirmed = await gatedExecuteSQL({
      connection_string: CONN.mysql,
      query: `DELETE FROM ${table}`,
      confirm: true,
      response_format: "markdown",
    });
    expect(confirmed.content[0].text).toContain("Rows affected");

    const afterDelete = await executeSQL({ connection_string: CONN.mysql, query: `SELECT * FROM ${table}`, confirm: false, response_format: "json" });
    const parsedAfterDelete = JSON.parse(afterDelete.content[0].text);
    expect(parsedAfterDelete.rowCount).toBe(0);
  });
});

describe("confirm=true gating against mssql", () => {
  it("blocks UPDATE without WHERE until confirm:true is passed", async () => {
    const table = uniqueTableName("confirm_update");
    await createTable({
      connection_string: CONN.mssql,
      table,
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });

    const blocked = await gatedExecuteSQL({
      connection_string: CONN.mssql,
      query: `UPDATE ${table} SET id = 1`,
      confirm: false,
      response_format: "markdown",
    });
    expect(blocked.structuredContent).toMatchObject({ reason: "destructive_confirmation_required" });

    const confirmed = await gatedExecuteSQL({
      connection_string: CONN.mssql,
      query: `UPDATE ${table} SET id = 1`,
      confirm: true,
      response_format: "markdown",
    });
    expect(confirmed.content[0].text).toContain("Rows affected");
  });
});

describe("confirm=true gating against db2", () => {
  it("blocks DROP TABLE until confirm:true is passed (exercises the DB2 dialect path)", async () => {
    const table = uniqueTableName("confirm_drop");
    await createTable({
      connection_string: CONN.db2,
      table,
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });

    const blocked = await gatedExecuteSQL({
      connection_string: CONN.db2,
      query: `DROP TABLE ${table}`,
      confirm: false,
      response_format: "markdown",
    });
    expect(blocked.structuredContent).toMatchObject({ blocked: true, reason: "destructive_confirmation_required" });

    const confirmed = await gatedExecuteSQL({
      connection_string: CONN.db2,
      query: `DROP TABLE ${table}`,
      confirm: true,
      response_format: "markdown",
    });
    expect(confirmed.content[0].text).not.toContain("blocked");
  });
});
