import { describe, it, expect, afterAll } from "vitest";
import { createTable } from "../../tools/ddl-tools.js";
import { listSchemas } from "../../tools/database-tools.js";
import { evictAll } from "../../services/pool-cache.js";
import { newSqliteConnectionString, uniqueTableName } from "./setup.js";

afterAll(async () => {
  await evictAll();
});

describe("sanitizeIdentifier happy path against sqlite", () => {
  it("creates a table end-to-end with a Zod-valid identifier", async () => {
    const connectionString = newSqliteConnectionString();
    const table = uniqueTableName("valid_table");

    const createResult = await createTable({
      connection_string: connectionString,
      table,
      columns: [{ name: "id", type: "INTEGER", primary_key: true }],
      response_format: "markdown",
    });

    expect(createResult.content[0].text).toContain("created successfully");

    const listResult = await listSchemas({
      connection_string: connectionString,
      response_format: "json",
    });
    const parsed = JSON.parse(listResult.content[0].text);
    const tableNames = parsed.schemas.flatMap((s: { tables: Array<{ table_name: string }> }) => s.tables.map(t => t.table_name));
    expect(tableNames).toContain(table);
  });
});
