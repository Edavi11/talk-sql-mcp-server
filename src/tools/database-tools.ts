/**
 * Database and Schema Tools
 * Tools for listing databases and schemas
 */

import { z } from "zod";
import { DatabaseType, ResponseFormat } from "../types.js";
import { createConnectionPool, detectDatabaseType } from "../services/connection-manager.js";
import { executeQuery, formatResultsAsMarkdown, formatResultsAsJSON } from "../services/query-executor.js";
import { ConnectionStringSchema, ResponseFormatSchema, DatabaseNameSchema } from "../schemas/connection.js";
import { getConnectionString } from "../constants.js";

/**
 * Schema for db_ping tool
 */
export const TestConnectionInputSchema = z.object({
  connection_string: ConnectionStringSchema,
  response_format: ResponseFormatSchema
}).strict();

export type TestConnectionInput = z.infer<typeof TestConnectionInputSchema>;

/**
 * Schema for db_list_databases tool
 */
export const ListDatabasesInputSchema = z.object({
  connection_string: ConnectionStringSchema,
  response_format: ResponseFormatSchema
}).strict();

export type ListDatabasesInput = z.infer<typeof ListDatabasesInputSchema>;

/**
 * Schema for sql_list_schemas tool
 */
export const ListSchemasInputSchema = z.object({
  connection_string: ConnectionStringSchema,
  database: DatabaseNameSchema,
  response_format: ResponseFormatSchema
}).strict();

export type ListSchemasInput = z.infer<typeof ListSchemasInputSchema>;

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
    default:
      throw new Error(`Unsupported database type: ${dbType}`);
  }
}

/**
 * Tests database connectivity and returns server info
 */
export async function testConnection(params: TestConnectionInput): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: { [x: string]: unknown } }> {
  let connectionString: string;
  try {
    connectionString = getConnectionString(params.connection_string);
  } catch (error) {
    const msg = "No connection string provided and SQL_CONNECTION_STRING environment variable is not set. " +
      "Provide a connection_string parameter (e.g. postgresql://user:pass@host:5432/db).";
    return { content: [{ type: "text", text: msg }] };
  }

  const dbType = detectDatabaseType(connectionString);
  const startMs = Date.now();
  let connectionPool;

  try {
    connectionPool = await createConnectionPool(connectionString);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const advice = getConnectionErrorAdvice(dbType, errorMsg);
    const text = `Connection FAILED (${dbType}): ${errorMsg}\n\n${advice}`;
    if (params.response_format === ResponseFormat.JSON) {
      const json = { success: false, database_type: dbType, error: errorMsg, advice };
      return { content: [{ type: "text", text: JSON.stringify(json, null, 2) }], structuredContent: json };
    }
    return { content: [{ type: "text", text: text }] };
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

  lines.push("- Use db_ping with the corrected connection string before retrying other tools.");
  return lines.join("\n");
}

/**
 * Lists all databases
 */
export async function listDatabases(params: ListDatabasesInput): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: { [x: string]: unknown } }> {
  const connectionString = getConnectionString(params.connection_string);
  const connectionPool = await createConnectionPool(connectionString);
  
  try {
    const dbType = detectDatabaseType(connectionString);
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
}

/**
 * Lists schemas and their tables
 */
export async function listSchemas(params: ListSchemasInput): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: { [x: string]: unknown } }> {
  const connectionString = getConnectionString(params.connection_string);
  const connectionPool = await createConnectionPool(connectionString);
  
  try {
    const dbType = detectDatabaseType(connectionString);
    
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
}
