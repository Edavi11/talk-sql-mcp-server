/**
 * Trigger Tools
 * Tools for creating database triggers
 */

import { z } from "zod";
import { DatabaseType, ResponseFormat } from "../types.js";
import { detectDatabaseType, sanitizeIdentifier } from "../services/connection-manager.js";
import { executeQuery } from "../services/query-executor.js";
import { ConnectionStringSchema, ConnectionNameSchema, ResponseFormatSchema, TableNameSchema, SchemaNameSchema } from "../schemas/connection.js";
import { getOrCreateResolvedPool } from "../services/pool-cache.js";

/**
 * Schema for db_create_trigger tool
 */
export const CreateTriggerInputSchema = z.object({
  connection_name: ConnectionNameSchema,
  connection_string: ConnectionStringSchema,
  schema: SchemaNameSchema,
  table: TableNameSchema,
  trigger_name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_]+$/),
  timing: z.enum(["BEFORE", "AFTER"]),
  event: z.enum(["INSERT", "UPDATE", "DELETE"]),
  procedure: z.string().min(1).max(10000).describe("SQL code for the trigger body"),
  response_format: ResponseFormatSchema
}).strict();

export type CreateTriggerInput = z.infer<typeof CreateTriggerInputSchema>;

/**
 * Builds CREATE TRIGGER query based on database type
 */
function buildCreateTriggerQuery(
  dbType: DatabaseType,
  schema: string | undefined,
  table: string,
  triggerName: string,
  timing: "BEFORE" | "AFTER",
  event: "INSERT" | "UPDATE" | "DELETE",
  procedure: string
): string {
  const safeTable = sanitizeIdentifier(table);
  const safeSchema = schema ? sanitizeIdentifier(schema) : undefined;
  const safeTriggerName = sanitizeIdentifier(triggerName);
  const tableName = safeSchema ? `${safeSchema}.${safeTable}` : safeTable;

  switch (dbType) {
    case DatabaseType.POSTGRESQL:
      return `
CREATE OR REPLACE FUNCTION ${safeSchema ? `${safeSchema}.` : ""}${safeTriggerName}_func()
RETURNS TRIGGER AS $$
BEGIN
  ${procedure}
  RETURN ${timing === "BEFORE" ? "NEW" : event === "DELETE" ? "OLD" : "NEW"};
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ${safeTriggerName}
  ${timing} ${event} ON ${tableName}
  FOR EACH ROW
  EXECUTE FUNCTION ${safeSchema ? `${safeSchema}.` : ""}${safeTriggerName}_func();
      `.trim();

    case DatabaseType.MYSQL:
      return `
CREATE TRIGGER ${safeTriggerName}
  ${timing} ${event} ON ${tableName}
  FOR EACH ROW
BEGIN
  ${procedure}
END;
      `.trim();

    case DatabaseType.SQLSERVER:
      return `
CREATE TRIGGER ${safeSchema ? `${safeSchema}.` : ""}${safeTriggerName}
  ON ${tableName}
  ${timing === "AFTER" ? "AFTER" : "INSTEAD OF"} ${event}
AS
BEGIN
  ${procedure}
END;
      `.trim();

    case DatabaseType.SQLITE:
      return `
CREATE TRIGGER ${safeTriggerName}
  ${timing} ${event} ON ${tableName}
  FOR EACH ROW
BEGIN
  ${procedure}
END;
      `.trim();

    default:
      throw new Error(`Unsupported database type: ${dbType}`);
  }
}

/**
 * Creates a trigger
 */
export async function createTrigger(params: CreateTriggerInput): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: { [x: string]: unknown } }> {
  const { pool: connectionPool, connectionString } = await getOrCreateResolvedPool({
    connection_string: params.connection_string,
    connection_name: params.connection_name
  });

  try {
    const dbType = detectDatabaseType(connectionString);
    const query = buildCreateTriggerQuery(
      dbType,
      params.schema,
      params.table,
      params.trigger_name,
      params.timing,
      params.event,
      params.procedure
    );

    // Execute query (may be multiple statements for PostgreSQL)
    const statements = query.split(";").filter(s => s.trim().length > 0);

    for (const statement of statements) {
      if (statement.trim()) {
        await executeQuery({
          connectionPool,
          query: statement.trim() + (dbType === DatabaseType.POSTGRESQL && statement.includes("CREATE FUNCTION") ? "" : ";")
        });
      }
    }

    const tableName = params.schema ? `${params.schema}.${params.table}` : params.table;
    const message = `Trigger '${params.trigger_name}' created successfully on table '${tableName}'.`;

    if (params.response_format === ResponseFormat.JSON) {
      const jsonOutput = {
        success: true,
        message,
        trigger_name: params.trigger_name,
        table: tableName,
        timing: params.timing,
        event: params.event,
        query
      };
      return {
        content: [{ type: "text", text: JSON.stringify(jsonOutput, null, 2) }],
        structuredContent: jsonOutput
      };
    }

    return {
      content: [{ type: "text", text: `${message}\n\nQuery executed:\n\`\`\`sql\n${query}\n\`\`\`` }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error creating trigger: ${error instanceof Error ? error.message : String(error)}`
      }]
    };
  }
}
