/**
 * Database and Schema Tools
 * Tools for listing databases and schemas
 */

import { z } from "zod";
import { DatabaseType, ResponseFormat } from "../types.js";
import { createConnectionPool, detectDatabaseType } from "../services/connection-manager.js";
import { executeQuery, formatResultsAsMarkdown, formatResultsAsJSON } from "../services/query-executor.js";
import { ConnectionStringSchema, ConnectionNameSchema, ResponseFormatSchema, DatabaseNameSchema } from "../schemas/connection.js";
import { resolveConnection, getNamedConnections } from "../constants.js";

/**
 * Schema for db_ping tool
 */
export const TestConnectionInputSchema = z.object({
  connection_name: ConnectionNameSchema,
  connection_string: ConnectionStringSchema,
  response_format: ResponseFormatSchema
}).strict();

export type TestConnectionInput = z.infer<typeof TestConnectionInputSchema>;

/**
 * Schema for db_list_databases tool
 */
export const ListDatabasesInputSchema = z.object({
  connection_name: ConnectionNameSchema,
  connection_string: ConnectionStringSchema,
  response_format: ResponseFormatSchema
}).strict();

export type ListDatabasesInput = z.infer<typeof ListDatabasesInputSchema>;

/**
 * Schema for db_list_tables tool
 */
export const ListSchemasInputSchema = z.object({
  connection_name: ConnectionNameSchema,
  connection_string: ConnectionStringSchema,
  database: DatabaseNameSchema,
  response_format: ResponseFormatSchema
}).strict();

export type ListSchemasInput = z.infer<typeof ListSchemasInputSchema>;

/**
 * Schema for db_list_connections tool
 */
export const ListConnectionsInputSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

export type ListConnectionsInput = z.infer<typeof ListConnectionsInputSchema>;

/**
 * Gets the query to list databases based on database type
 */
function getListDatabasesQuery(dbType: DatabaseType): string {
  switch (dbType) {
    case DatabaseType.POSTGRESQL:
      return "SELECT datname as name FROM pg_database WHERE datistemplate = false ORDER BY datname";
    case DatabaseType.MYSQL:
      return "SHOW DATABASES";
    case DatabaseType.SQLSERVER:
      return "SELECT name FROM sys.databases WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb') ORDER BY name";
    case DatabaseType.SQLITE:
      // SQLite doesn't have multiple databases concept
      return "SELECT 'main' as name";
    case DatabaseType.DB2:
      return "SELECT SCHEMANAME as name FROM SYSCAT.SCHEMATA WHERE SCHEMANAME NOT LIKE 'SYS%' ORDER BY SCHEMANAME";
    default:
      throw new Error(`Unsupported database type: ${dbType}`);
  }
}

/**
 * Gets the query to list schemas/tables based on database type
 */
function getListSchemasQuery(dbType: DatabaseType, database?: string): string {
  switch (dbType) {
    case DatabaseType.POSTGRESQL:
      if (database) {
        // Connect to specific database and list schemas
        return `
          SELECT
            schema_name as schema_name,
            COUNT(table_name) as table_count
          FROM information_schema.tables
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          GROUP BY schema_name
          ORDER BY schema_name
        `;
      }
      return `
        SELECT
          schema_name as schema_name,
          COUNT(table_name) as table_count
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        GROUP BY schema_name
        ORDER BY schema_name
      `;
    case DatabaseType.MYSQL:
      if (database) {
        return `
          SELECT
            table_schema as schema_name,
            COUNT(table_name) as table_count
          FROM information_schema.tables
          WHERE table_schema = ?
          GROUP BY table_schema
          ORDER BY table_schema
        `;
      }
      return `
        SELECT
          table_schema as schema_name,
          COUNT(table_name) as table_count
        FROM information_schema.tables
        WHERE table_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
        GROUP BY table_schema
        ORDER BY table_schema
      `;
    case DatabaseType.SQLSERVER:
      if (database) {
        return `
          SELECT
            SCHEMA_NAME(schema_id) as schema_name,
            COUNT(*) as table_count
          FROM ${database}.sys.tables
          GROUP BY SCHEMA_NAME(schema_id)
          ORDER BY schema_name
        `;
      }
      return `
        SELECT
          SCHEMA_NAME(schema_id) as schema_name,
          COUNT(*) as table_count
        FROM sys.tables
        GROUP BY SCHEMA_NAME(schema_id)
        ORDER BY schema_name
      `;
    case DatabaseType.SQLITE:
      // SQLite doesn't have schemas, return tables in main schema
      return `
        SELECT
          'main' as schema_name,
          COUNT(*) as table_count
        FROM sqlite_master
        WHERE type = 'table'
      `;
    case DatabaseType.DB2:
      if (database) {
        return `
          SELECT
            TABSCHEMA as schema_name,
            COUNT(*) as table_count
          FROM SYSCAT.TABLES
          WHERE TABSCHEMA = '${database.replace(/'/g, "''")}'
            AND TYPE = 'T'
          GROUP BY TABSCHEMA
          ORDER BY TABSCHEMA
        `;
      }
      return `
        SELECT
          TABSCHEMA as schema_name,
          COUNT(*) as table_count
        FROM SYSCAT.TABLES
        WHERE TABSCHEMA NOT LIKE 'SYS%'
          AND TYPE = 'T'
        GROUP BY TABSCHEMA
        ORDER BY TABSCHEMA
      `;
    default:
      throw new Error(`Unsupported database type: ${dbType}`);
  }
}

/**
 * Gets detailed schema information with tables
 */
function getSchemaDetailsQuery(dbType: DatabaseType, schema?: string): string {
  const schemaFilter = schema ? `AND table_schema = '${schema.replace(/'/g, "''")}'` : "";

  switch (dbType) {
    case DatabaseType.POSTGRESQL:
      return `
        SELECT
          table_schema as schema_name,
          table_name,
          table_type
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ${schemaFilter}
        ORDER BY table_schema, table_name
      `;
    case DatabaseType.MYSQL:
      const mysqlSchemaFilter = schema ? `AND table_schema = '${schema.replace(/'/g, "''")}'` : "";
      return `
        SELECT
          table_schema as schema_name,
          table_name,
          table_type
        FROM information_schema.tables
        WHERE table_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
        ${mysqlSchemaFilter}
        ORDER BY table_schema, table_name
      `;
    case DatabaseType.SQLSERVER:
      const sqlServerSchemaFilter = schema ? `AND SCHEMA_NAME(schema_id) = '${schema.replace(/'/g, "''")}'` : "";
      return `
        SELECT
          SCHEMA_NAME(schema_id) as schema_name,
          name as table_name,
          type_desc as table_type
        FROM sys.tables
        WHERE 1=1
        ${sqlServerSchemaFilter}
        ORDER BY schema_name, table_name
      `;
    case DatabaseType.SQLITE:
      return `
        SELECT
          'main' as schema_name,
          name as table_name,
          type as table_type
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
      `;
    case DatabaseType.DB2: {
      const db2SchemaFilter = schema ? `AND TABSCHEMA = '${schema.replace(/'/g, "''")}'` : "AND TABSCHEMA NOT LIKE 'SYS%'";
      return `
        SELECT
          TABSCHEMA as schema_name,
          TABNAME as table_name,
          CASE TYPE WHEN 'T' THEN 'TABLE' WHEN 'V' THEN 'VIEW' ELSE TYPE END as table_type
        FROM SYSCAT.TABLES
        WHERE TYPE IN ('T', 'V')
          ${db2SchemaFilter}
        ORDER BY TABSCHEMA, TABNAME
      `;
    }
    default:
      throw new Error(`Unsupported database type: ${dbType}`);
  }
}

/**
 * Tests database connectivity and returns server info
 */
export async function testConnection(params: TestConnectionInput): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: { [x: string]: unknown } }> {
  let resolved;
  try {
    resolved = await resolveConnection({
      connection_string: params.connection_string,
      connection_name: params.connection_name
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Connection error: ${msg}` }] };
  }

  const dbType = detectDatabaseType(resolved.connectionString);
  const startMs = Date.now();
  let connectionPool;

  try {
    connectionPool = await createConnectionPool(resolved.connectionString);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const advice = getConnectionErrorAdvice(dbType, errorMsg);
    const text = `Connection FAILED (${dbType}): ${errorMsg}\n\n${advice}`;
    if (params.response_format === ResponseFormat.JSON) {
      const json = { success: false, database_type: dbType, error: errorMsg, advice };
      return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }], structuredContent: json };
    }
    return { content: [{ type: "text", text: text }] };
  } finally {
    await resolved.cleanup();
  }

  try {
    const latencyMs = Date.now() - startMs;
    const versionQuery = getVersionQuery(dbType);
    const versionResult = await executeQuery({ connectionPool, query: versionQuery });
    const version = versionResult.rows.length > 0 && typeof versionResult.rows[0] === "object"
      ? Object.values(versionResult.rows[0] as Record<string, unknown>)[0]
      : "unknown";

    if (params.response_format === ResponseFormat.JSON) {
      const json = { success: true, database_type: dbType, latency_ms: latencyMs, server_version: String(version) };
      return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }], structuredContent: json };
    }
    return {
      content: [{ type: "text", text: `Connection OK (${dbType})\nLatency: ${latencyMs}ms\nServer version: ${version}` }]
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Connected but version query failed: ${errorMsg}` }] };
  } finally {
    await connectionPool.close();
  }
}

function getVersionQuery(dbType: DatabaseType): string {
  switch (dbType) {
    case DatabaseType.POSTGRESQL: return "SELECT version() as version";
    case DatabaseType.MYSQL:      return "SELECT VERSION() as version";
    case DatabaseType.SQLSERVER:  return "SELECT @@VERSION as version";
    case DatabaseType.SQLITE:     return "SELECT sqlite_version() as version";
    case DatabaseType.DB2:        return "SELECT SERVICE_LEVEL as version FROM TABLE(SYSPROC.ENV_GET_INST_INFO()) AS INSTANCEINFO";
    default: return "SELECT 1 as version";
  }
}

function getConnectionErrorAdvice(dbType: DatabaseType, error: string): string {
  const lower = error.toLowerCase();
  const lines: string[] = ["Suggestions:"];

  if (lower.includes("password") || lower.includes("authentication") || lower.includes("access denied")) {
    lines.push("- Verify the username and password in the connection string are correct.");
  }
  if (lower.includes("econnrefused") || lower.includes("connect etimedout") || lower.includes("could not connect")) {
    lines.push("- The server is not reachable. Check that the host/port are correct and the server is running.");
    if (dbType === DatabaseType.POSTGRESQL) lines.push("- Default PostgreSQL port is 5432.");
    if (dbType === DatabaseType.MYSQL)      lines.push("- Default MySQL port is 3306.");
    if (dbType === DatabaseType.SQLSERVER)  lines.push("- Default SQL Server port is 1433.");
  }
  if (lower.includes("database") && (lower.includes("does not exist") || lower.includes("unknown database"))) {
    lines.push("- The database name in the connection string does not exist. Use db_list_databases to see available databases.");
  }
  if (lower.includes("certificate") || lower.includes("ssl")) {
    lines.push("- Try adding ?trustServerCertificate=true or ?ssl=false to the connection string.");
  }
  if (dbType === DatabaseType.SQLSERVER && lower.includes("login")) {
    lines.push("- For SQL Server, ensure the login has been granted access and the instance name is correct.");
    lines.push("- Try adding ?encrypt=false&trustServerCertificate=true to the connection string.");
  }

  if (dbType === DatabaseType.DB2 && (lower.includes("ibm_db") || lower.includes("odbc") || lower.includes("cli"))) {
    lines.push("- IBM DB2 requires the ibm_db package. Install it with: npm install ibm_db");
    lines.push("- The IBM ODBC CLI driver is downloaded automatically during ibm_db installation.");
  }
  if (dbType === DatabaseType.DB2) {
    lines.push("- Default IBM DB2 port is 50000. Connection string format: db2://user:pass@host:50000/DATABASE");
  }

  lines.push("- Use db_ping with the corrected connection string before retrying other tools.");
  return lines.join("\n");
}

/**
 * Lists all databases
 */
export async function listDatabases(params: ListDatabasesInput): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: { [x: string]: unknown } }> {
  const resolved = await resolveConnection({
    connection_string: params.connection_string,
    connection_name: params.connection_name
  });

  try {
    const connectionPool = await createConnectionPool(resolved.connectionString);

    try {
      const dbType = detectDatabaseType(resolved.connectionString);
      const query = getListDatabasesQuery(dbType);

      const result = await executeQuery({
        connectionPool,
        query
      });

      // Format results
      let textContent: string;
      if (params.response_format === ResponseFormat.MARKDOWN) {
        textContent = `# Databases\n\n${formatResultsAsMarkdown(result.rows, result.columns)}\n\nTotal: ${result.rowCount}`;
      } else {
        const jsonOutput = {
          total: result.rowCount,
          databases: result.rows
        };
        textContent = formatResultsAsJSON(result.rows, result.rowCount, result.columns);
        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: jsonOutput
        };
      }

      return {
        content: [{ type: "text", text: textContent }]
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const lower = errorMsg.toLowerCase();
      const hints: string[] = [];
      if (lower.includes("econnrefused") || lower.includes("etimedout") || lower.includes("failed to connect") || lower.includes("connection")) {
        hints.push("Use db_ping to diagnose and fix the connection before retrying.");
      } else if (lower.includes("permission") || lower.includes("access denied")) {
        hints.push("The database user may not have permission to list databases.");
      }
      const hintText = hints.length > 0 ? `\n\nNext steps:\n${hints.map(h => `- ${h}`).join("\n")}` : "";
      return {
        content: [{
          type: "text",
          text: `Error listing databases: ${errorMsg}${hintText}`
        }]
      };
    } finally {
      await connectionPool.close();
    }
  } finally {
    await resolved.cleanup();
  }
}

/**
 * Lists schemas and their tables
 */
export async function listSchemas(params: ListSchemasInput): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: { [x: string]: unknown } }> {
  const resolved = await resolveConnection({
    connection_string: params.connection_string,
    connection_name: params.connection_name
  });

  try {
    const connectionPool = await createConnectionPool(resolved.connectionString);

    try {
      const dbType = detectDatabaseType(resolved.connectionString);

      // Get schema summary
      const schemaQuery = getListSchemasQuery(dbType, params.database);
      const schemaResult = await executeQuery({
        connectionPool,
        query: schemaQuery,
        params: params.database ? [params.database] : []
      });

      // Get detailed table information
      const detailsQuery = getSchemaDetailsQuery(dbType, params.database);
      const detailsResult = await executeQuery({
        connectionPool,
        query: detailsQuery
      });

      // Group tables by schema
      const schemasMap = new Map<string, Array<{ table_name: string; table_type: string }>>();

      for (const row of detailsResult.rows) {
        if (row && typeof row === 'object') {
          const rowObj = row as Record<string, unknown>;
          const schemaName = String(rowObj.schema_name || 'main');
          const tableName = String(rowObj.table_name || '');
          const tableType = String(rowObj.table_type || '');

          if (!schemasMap.has(schemaName)) {
            schemasMap.set(schemaName, []);
          }
          schemasMap.get(schemaName)!.push({ table_name: tableName, table_type: tableType });
        }
      }

      // Format results
      if (params.response_format === ResponseFormat.MARKDOWN) {
        const lines: string[] = ["# Schemas and Tables\n"];

        for (const [schemaName, tables] of schemasMap.entries()) {
          lines.push(`## Schema: ${schemaName}`);
          lines.push(`**Tables:** ${tables.length}\n`);

          if (tables.length > 0) {
            lines.push("| Table Name | Type |");
            lines.push("|------------|------|");
            for (const table of tables) {
              lines.push(`| ${table.table_name} | ${table.table_type} |`);
            }
          }
          lines.push("");
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }]
        };
      } else {
        const jsonOutput = {
          schemas: Array.from(schemasMap.entries()).map(([schemaName, tables]) => ({
            schema_name: schemaName,
            table_count: tables.length,
            tables: tables
          }))
        };

        return {
          content: [{ type: "text", text: JSON.stringify(jsonOutput, null, 2) }],
          structuredContent: jsonOutput
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const lower = errorMsg.toLowerCase();
      const hints: string[] = [];
      if (lower.includes("econnrefused") || lower.includes("etimedout") || lower.includes("failed to connect") || lower.includes("connection")) {
        hints.push("Use db_ping to diagnose and fix the connection before retrying.");
      } else if (lower.includes("database") && (lower.includes("does not exist") || lower.includes("unknown"))) {
        hints.push("The specified database does not exist. Use db_list_databases to see available databases.");
      } else if (lower.includes("permission") || lower.includes("access denied")) {
        hints.push("The database user may not have permission to list schemas.");
      }
      const hintText = hints.length > 0 ? `\n\nNext steps:\n${hints.map(h => `- ${h}`).join("\n")}` : "";
      return {
        content: [{
          type: "text",
          text: `Error listing schemas: ${errorMsg}${hintText}`
        }]
      };
    } finally {
      await connectionPool.close();
    }
  } finally {
    await resolved.cleanup();
  }
}

/**
 * Lists all named connections configured in TALK_SQL_CONFIG
 */
export async function listConnections(params: ListConnectionsInput): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: { [x: string]: unknown } }> {
  const connections = getNamedConnections();

  let entries: Array<{ name: string; type: string; has_ssh: boolean }>;

  if (connections && connections.length > 0) {
    entries = connections.map(c => ({
      name: c.name,
      type: detectDatabaseType(c.connectionString),
      has_ssh: !!c.ssh
    }));
  } else {
    // Legacy mode: check SQL_CONNECTION_STRING
    const legacyStr = process.env.SQL_CONNECTION_STRING;
    if (legacyStr && legacyStr.trim().length > 0) {
      entries = [{
        name: "default",
        type: detectDatabaseType(legacyStr),
        has_ssh: false
      }];
    } else {
      const json = {
        connections: [],
        total: 0,
        note: "No connections configured. Set TALK_SQL_CONFIG to a config file path or SQL_CONNECTION_STRING env var."
      };
      return {
        content: [{ type: "text", text: JSON.stringify(json, null, 2) }],
        structuredContent: json
      };
    }
  }

  const result = {
    connections: entries,
    total: entries.length,
    note: "Use connection_name parameter in other tools to specify which connection to use."
  };

  if (params.response_format === ResponseFormat.MARKDOWN) {
    const lines = ["# Configured Connections\n"];
    lines.push("| Name | Type | SSH |");
    lines.push("|------|------|-----|");
    for (const e of entries) {
      lines.push(`| ${e.name} | ${e.type} | ${e.has_ssh ? "yes" : "no"} |`);
    }
    lines.push(`\n**Total:** ${entries.length}`);
    lines.push("\nUse `connection_name` parameter in other tools to specify which connection to use.");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result
  };
}
