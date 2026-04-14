/**
 * Query Tools
 * Tools for executing SQL queries and selecting data
 */

import { z } from "zod";
import { DatabaseType, ResponseFormat, PaginatedResult } from "../types.js";
import { createConnectionPool, detectDatabaseType } from "../services/connection-manager.js";
import { executeQuery, formatResultsAsMarkdown, formatResultsAsJSON } from "../services/query-executor.js";
import { ConnectionStringSchema, ConnectionNameSchema, ResponseFormatSchema, QuerySchema, LimitSchema, OffsetSchema, WhereClauseSchema, ColumnsSchema, TableNameSchema, SchemaNameSchema } from "../schemas/connection.js";
import { DEFAULT_LIMIT, MAX_LIMIT, CHARACTER_LIMIT, resolveConnection } from "../constants.js";
import { sanitizeIdentifier } from "../services/connection-manager.js";

/**
 * Schema for db_query tool
 */
export const ExecuteSQLInputSchema = z.object({
  connection_name: ConnectionNameSchema,
  connection_string: ConnectionStringSchema,
  query: QuerySchema,
  response_format: ResponseFormatSchema
}).strict();

export type ExecuteSQLInput = z.infer<typeof ExecuteSQLInputSchema>;

/**
 * Schema for db_select tool
 */
export const SelectDataInputSchema = z.object({
  connection_name: ConnectionNameSchema,
  connection_string: ConnectionStringSchema,
  table: TableNameSchema,
  schema: SchemaNameSchema,
  columns: ColumnsSchema,
  where: WhereClauseSchema,
  limit: LimitSchema,
  offset: OffsetSchema,
  response_format: ResponseFormatSchema
}).strict();

export type SelectDataInput = z.infer<typeof SelectDataInputSchema>;

/**
 * Executes any SQL query
 */
export async function executeSQL(params: ExecuteSQLInput): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: { [x: string]: unknown } }> {
  const resolved = await resolveConnection({
    connection_string: params.connection_string,
    connection_name: params.connection_name
  });

  try {
    const connectionPool = await createConnectionPool(resolved.connectionString);

    try {
      const result = await executeQuery({
        connectionPool,
        query: params.query
      });

      // Check if query was a SELECT (has rows) or DML/DDL (has rowCount)
      const isSelectQuery = params.query.trim().toUpperCase().startsWith("SELECT");

      if (isSelectQuery) {
        // Format SELECT results
        let textContent: string;
        if (params.response_format === ResponseFormat.MARKDOWN) {
          textContent = `# Query Results\n\n${formatResultsAsMarkdown(result.rows, result.columns)}\n\n**Rows returned:** ${result.rowCount}`;
        } else {
          const jsonOutput = {
            rowCount: result.rowCount,
            columns: result.columns || [],
            rows: result.rows
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
      } else {
        // Format DML/DDL results
        const message = `Query executed successfully. Rows affected: ${result.rowCount}`;

        if (params.response_format === ResponseFormat.JSON) {
          const jsonOutput = {
            success: true,
            rowCount: result.rowCount,
            message
          };
          return {
            content: [{ type: "text", text: JSON.stringify(jsonOutput, null, 2) }],
            structuredContent: jsonOutput
          };
        }

        return {
          content: [{ type: "text", text: message }]
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const lower = errorMsg.toLowerCase();
      const hints: string[] = [];

      if (lower.includes("econnrefused") || lower.includes("etimedout") || lower.includes("failed to connect")) {
        hints.push("The database server is not reachable. Use db_ping to diagnose the connection first.");
      } else if (lower.includes("syntax error") || lower.includes("unexpected") || lower.includes("parse error")) {
        hints.push("The SQL query has a syntax error. Review the query and correct the syntax before retrying.");
        hints.push("For SQL Server batch scripts, use GO to separate statements.");
      } else if (lower.includes("does not exist") || lower.includes("no such table") || lower.includes("unknown table")) {
        hints.push("The table or column does not exist. Use db_list_tables to verify table names before retrying.");
      } else if (lower.includes("permission") || lower.includes("access denied") || lower.includes("privilege")) {
        hints.push("Insufficient permissions. The database user may not have the required privileges for this operation.");
      } else if (lower.includes("duplicate") || lower.includes("unique constraint") || lower.includes("already exists")) {
        hints.push("A unique constraint was violated. Check existing data before inserting or use ON CONFLICT/INSERT IGNORE.");
      } else if (lower.includes("connection") || lower.includes("socket")) {
        hints.push("Connection error. Use db_ping to verify connectivity and diagnose the issue.");
      }

      const hintText = hints.length > 0 ? `\n\nNext steps:\n${hints.map(h => `- ${h}`).join("\n")}` : "";
      return {
        content: [{
          type: "text",
          text: `Error executing query: ${errorMsg}${hintText}`
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
 * Builds a SELECT query with pagination and filters, adapted to the database type
 */
function buildSelectQuery(
  table: string,
  schema: string | undefined,
  columns: string[] | undefined,
  where: string | undefined,
  limit: number,
  offset: number,
  dbType: DatabaseType
): string {
  // Sanitize identifiers
  const safeTable = sanitizeIdentifier(table);
  const safeSchema = schema ? sanitizeIdentifier(schema) : undefined;

  // Build column list
  const columnList = columns && columns.length > 0
    ? columns.map(col => sanitizeIdentifier(col)).join(", ")
    : "*";

  // Build table name with schema if provided
  const tableName = safeSchema ? `${safeSchema}.${safeTable}` : safeTable;

  const whereClause = where ? ` WHERE ${where}` : "";

  // SQL Server and DB2 use OFFSET/FETCH instead of LIMIT/OFFSET
  if (dbType === DatabaseType.SQLSERVER) {
    return `SELECT ${columnList} FROM ${tableName}${whereClause} ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  }

  if (dbType === DatabaseType.DB2) {
    return `SELECT ${columnList} FROM ${tableName}${whereClause} ORDER BY (SELECT 1 FROM SYSIBM.SYSDUMMY1) OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  }

  return `SELECT ${columnList} FROM ${tableName}${whereClause} LIMIT ${limit} OFFSET ${offset}`;
}

/**
 * Gets total count for pagination
 */
async function getTotalCount(
  connectionPool: Awaited<ReturnType<typeof createConnectionPool>>,
  table: string,
  schema: string | undefined,
  where: string | undefined
): Promise<number> {
  const safeTable = sanitizeIdentifier(table);
  const safeSchema = schema ? sanitizeIdentifier(schema) : undefined;
  const tableName = safeSchema ? `${safeSchema}.${safeTable}` : safeTable;
  const whereClause = where ? ` WHERE ${where}` : "";

  const countQuery = `SELECT COUNT(*) as total FROM ${tableName}${whereClause}`;

  try {
    const result = await executeQuery({
      connectionPool,
      query: countQuery
    });

    if (result.rows.length > 0 && result.rows[0] && typeof result.rows[0] === 'object') {
      const row = result.rows[0] as Record<string, unknown>;
      const total = row.total || row.TOTAL || row.count || row.COUNT;
      return typeof total === 'number' ? total : parseInt(String(total), 10);
    }

    return 0;
  } catch {
    // If count fails, return -1 to indicate unknown
    return -1;
  }
}

/**
 * Selects data from a table with pagination
 */
export async function selectData(params: SelectDataInput): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: { [x: string]: unknown } }> {
  const resolved = await resolveConnection({
    connection_string: params.connection_string,
    connection_name: params.connection_name
  });

  try {
    const dbType = detectDatabaseType(resolved.connectionString);
    const connectionPool = await createConnectionPool(resolved.connectionString);

    try {
      // Build and execute SELECT query
      const query = buildSelectQuery(
        params.table,
        params.schema,
        params.columns,
        params.where,
        params.limit,
        params.offset,
        dbType
      );

      const result = await executeQuery({
        connectionPool,
        query
      });

      // Get total count for pagination
      const total = await getTotalCount(
        connectionPool,
        params.table,
        params.schema,
        params.where
      );

      // Check character limit
      let textContent: string;
      const hasMore = total >= 0 ? total > params.offset + result.rows.length : false;
      const nextOffset = hasMore ? params.offset + result.rows.length : undefined;

      if (params.response_format === ResponseFormat.MARKDOWN) {
        const lines: string[] = [];
        lines.push(`# Data from ${params.schema ? `${params.schema}.` : ""}${params.table}`);
        lines.push("");

        if (total >= 0) {
          lines.push(`**Total rows:** ${total}`);
        }
        lines.push(`**Showing:** ${result.rows.length} rows (offset: ${params.offset}, limit: ${params.limit})`);
        lines.push("");

        const markdownTable = formatResultsAsMarkdown(result.rows, result.columns);
        const fullContent = lines.join("\n") + "\n\n" + markdownTable;

        // Check character limit
        if (fullContent.length > CHARACTER_LIMIT) {
          const truncatedRows = result.rows.slice(0, Math.floor(result.rows.length / 2));
          const truncatedTable = formatResultsAsMarkdown(truncatedRows, result.columns);
          textContent = lines.join("\n") + "\n\n" + truncatedTable + `\n\n*Response truncated. Use offset=${nextOffset || params.offset + truncatedRows.length} to see more results.*`;
        } else {
          textContent = fullContent;
        }

        if (hasMore && nextOffset) {
          textContent += `\n\n**Has more:** Yes (use offset=${nextOffset} for next page)`;
        }
      } else {
        const paginatedResult: PaginatedResult = {
          total: total >= 0 ? total : undefined,
          count: result.rows.length,
          offset: params.offset,
          limit: params.limit,
          data: result.rows,
          has_more: hasMore
        };

        if (nextOffset) {
          paginatedResult.next_offset = nextOffset;
        }

        textContent = JSON.stringify(paginatedResult, null, 2);

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: paginatedResult as unknown as { [x: string]: unknown }
        };
      }

      return {
        content: [{ type: "text", text: textContent }]
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const lower = errorMsg.toLowerCase();
      const hints: string[] = [];

      if (lower.includes("econnrefused") || lower.includes("etimedout") || lower.includes("failed to connect")) {
        hints.push("Use db_ping to diagnose the connection before retrying.");
      } else if (lower.includes("does not exist") || lower.includes("no such table") || lower.includes("unknown table")) {
        hints.push("The table does not exist. Use db_list_tables to see available tables, then retry with the correct table name.");
      } else if (lower.includes("column") && (lower.includes("does not exist") || lower.includes("unknown"))) {
        hints.push("One or more columns don't exist. Try again without specifying columns (omit the columns parameter) to select all columns.");
      } else if (lower.includes("syntax error")) {
        hints.push("There is a syntax error in the WHERE clause. Simplify or remove the where parameter and retry.");
      }

      const hintText = hints.length > 0 ? `\n\nNext steps:\n${hints.map(h => `- ${h}`).join("\n")}` : "";
      return {
        content: [{
          type: "text",
          text: `Error selecting data: ${errorMsg}${hintText}`
        }]
      };
    } finally {
      await connectionPool.close();
    }
  } finally {
    await resolved.cleanup();
  }
}
