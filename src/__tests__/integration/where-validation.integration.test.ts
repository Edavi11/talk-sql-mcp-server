import { describe, it, expect, afterAll } from "vitest";
import { selectData } from "../../tools/query-tools.js";
import { createTable } from "../../tools/ddl-tools.js";
import { executeSQL } from "../../tools/query-tools.js";
import { evictAll } from "../../services/pool-cache.js";
import { CONN, uniqueTableName } from "./setup.js";

afterAll(async () => {
  await evictAll();
});

describe.each([
  ["postgresql", CONN.postgresql],
  ["mysql", CONN.mysql],
])("WHERE clause validation against %s", (_label, connectionString) => {
  it("accepts a normal WHERE clause and returns rows", async () => {
    const table = uniqueTableName("where_ok");
    await createTable({
      connection_string: connectionString,
      table,
      columns: [{ name: "id", type: "INT", primary_key: true }],
      response_format: "markdown",
    });
    await executeSQL({
      connection_string: connectionString,
      query: `INSERT INTO ${table} (id) VALUES (1)`,
      confirm: false,
      response_format: "markdown",
    });

    const result = await selectData({
      connection_string: connectionString,
      table,
      where: "id = 1",
      limit: 10,
      offset: 0,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("id");
  });

  it("rejects a stacked statement in WHERE before reaching the database", async () => {
    const table = uniqueTableName("where_stacked");
    await createTable({
      connection_string: connectionString,
      table,
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });

    const result = await selectData({
      connection_string: connectionString,
      table,
      where: `1=1; DROP TABLE ${table}`,
      limit: 10,
      offset: 0,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("Error selecting data");

    // The table must still exist - the stacked DROP never reached the database
    const verify = await executeSQL({
      connection_string: connectionString,
      query: `SELECT * FROM ${table}`,
      confirm: false,
      response_format: "markdown",
    });
    expect(verify.content[0].text).not.toContain("Error executing query");
  });
});

describe("WHERE clause validation against mssql", () => {
  it("rejects a subquery referencing another table", async () => {
    const table = uniqueTableName("where_subq");
    await createTable({
      connection_string: CONN.mssql,
      table,
      columns: [{ name: "id", type: "INT" }],
      response_format: "markdown",
    });

    const result = await selectData({
      connection_string: CONN.mssql,
      table,
      where: "id IN (SELECT id FROM some_other_table)",
      limit: 10,
      offset: 0,
      response_format: "markdown",
    });

    expect(result.content[0].text).toContain("Error selecting data");
  });
});
