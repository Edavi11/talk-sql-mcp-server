/**
 * Query Executor for SQL databases
 * Executes queries and formats results consistently across database types
 */

import pg from "pg";
import mysql from "mysql2/promise";
import sql from "mssql";
import type BetterSqlite3 from "better-sqlite3";
import { DatabaseType, QueryResult } from "../types.js";
import { ConnectionPool, detectDatabaseType } from "./connection-manager.js";
import { MAX_QUERY_LENGTH } from "../constants.js";

export interface ExecuteQueryOptions {
  connectionPool: ConnectionPool;
  query: string;
  params?: unknown[];
}

export interface ExecuteQueryResult {
  rows: unknown[];
  rowCount: number;
  columns?: string[];
}

/**
 * Splits SQL Server script by GO statements
 */
function splitSQLServerBatches(script: string): string[] {
  // Split by GO (case insensitive, can have whitespace before/after)
  const batches = script.split(/\bGO\b/i).map(batch => batch.trim()).filter(batch => batch.length > 0);
  return batches;
}

/**
 * Processes SQL Server-specific commands (USE, SET IDENTITY_INSERT, etc.)
 */
function processSQLServerBatch(batch: string): string | null {
  const trimmed = batch.trim();
  const upper = trimmed.toUpperCase();
  
  // Ignore USE commands (we're already connected to the database)
  if (upper.startsWith("USE ")) {
    return null; // Skip this batch
  }
  
  // Return the batch as-is (SET IDENTITY_INSERT and other commands will be executed)
  return trimmed;
}

/**
 * Executes a query and returns normalized results
 * Supports SQL Server batch scripts with GO statements
 */
export async function executeQuery(options: ExecuteQueryOptions): Promise<ExecuteQueryResult> {
  const { connectionPool, query, params = [] } = options;
  
  // Validate query length
  if (query.length > MAX_QUERY_LENGTH) {
    throw new Error(`Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`);
  }
  
  // Handle SQL Server batch scripts with GO
  if (connectionPool.type === DatabaseType.SQLSERVER && /\bGO\b/i.test(query)) {
    return executeSQLServerBatchScript(connectionPool.pool as sql.ConnectionPool, query);
  }

  switch (connectionPool.type) {
    case DatabaseType.POSTGRESQL:
      return executePostgreSQLQuery(connectionPool.pool as pg.Pool, query, params);
    case DatabaseType.MYSQL:
      return executeMySQLQuery(connectionPool.pool as mysql.Pool, query, params);
    case DatabaseType.SQLSERVER:
      return executeSQLServerQuery(connectionPool.pool as sql.ConnectionPool, query, params);
    case DatabaseType.SQLITE:
      return executeSQLiteQuery(connectionPool.pool as BetterSqlite3.Database, query, params);
    case DatabaseType.DB2:
      return executeDB2Query(connectionPool.pool, query, params);
    default:
      throw new Error(`Unsupported database type: ${connectionPool.type}`);
  }
}

/**
 * Executes a SQL Server batch script with GO statements
 */
async function executeSQLServerBatchScript(
  pool: sql.ConnectionPool,
  script: string
): Promise<ExecuteQueryResult> {
  const batches = splitSQLServerBatches(script);
  let totalRowsAffected = 0;
  let lastResult: ExecuteQueryResult | null = null;
  
  for (const batch of batches) {
    const processedBatch = processSQLServerBatch(batch);
    
    // Skip empty batches or USE commands
    if (!processedBatch) {
      continue;
    }
    
    try {
      const request = pool.request();
      const result = await request.query(processedBatch);
      
      const rowsAffected = result.rowsAffected?.[0] || 0;
      totalRowsAffected += rowsAffected;
      
      // Store last result (for SELECT queries, this will be the result set)
      if (result.recordset && result.recordset.length > 0) {
        lastResult = {
          rows: result.recordset,
          rowCount: result.recordset.length,
          columns: result.recordset.columns ? Object.keys(result.recordset.columns) : []
        };
      } else {
        lastResult = {
          rows: [],
          rowCount: rowsAffected,
          columns: []
        };
      }
    } catch (error) {
      throw new Error(
        `Error executing batch: ${error instanceof Error ? error.message : String(error)}\n` +
        `Failed batch: ${processedBatch.substring(0, 200)}...`
      );
    }
  }
  
  // Return the last result, or a summary if no SELECT queries
  return lastResult || {
    rows: [],
    rowCount: totalRowsAffected,
    columns: []
  };
}

/**
 * Executes a query on PostgreSQL
 */
async function executePostgreSQLQuery(
  pool: pg.Pool,
  query: string,
  params: unknown[]
): Promise<ExecuteQueryResult> {
  try {
    const result = await pool.query(query, params);
    
    return {
      rows: result.rows,
      rowCount: result.rowCount || 0,
      columns: result.fields?.map((f: pg.FieldDef) => f.name) || []
    };
  } catch (error) {
    throw new Error(`PostgreSQL query error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Executes a query on MySQL
 */
async function executeMySQLQuery(
  pool: mysql.Pool,
  query: string,
  params: unknown[]
): Promise<ExecuteQueryResult> {
  try {
    const [rows, fields] = await pool.execute(query, params as any[]);
    
    // Convert RowDataPacket to plain objects
    const plainRows = Array.isArray(rows) 
      ? rows.map(row => {
          if (row && typeof row === 'object' && 'constructor' in row && row.constructor.name === 'RowDataPacket') {
            return { ...row as Record<string, unknown> };
          }
          return row;
        })
      : [];
    
    return {
      rows: plainRows,
      rowCount: Array.isArray(rows) ? rows.length : 0,
      columns: fields?.map(f => f.name) || []
    };
  } catch (error) {
    throw new Error(`MySQL query error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Executes a query on SQL Server
 */
async function executeSQLServerQuery(
  pool: sql.ConnectionPool,
  query: string,
  params: unknown[]
): Promise<ExecuteQueryResult> {
  try {
    const request = pool.request();
    
    // Add parameters if provided
    params.forEach((param, index) => {
      request.input(`param${index}`, param);
    });
    
    const result = await request.query(query);
    
    return {
      rows: result.recordset || [],
      rowCount: result.rowsAffected?.[0] || 0,
      columns: result.recordset.columns ? Object.keys(result.recordset.columns) : []
    };
  } catch (error) {
    throw new Error(`SQL Server query error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Executes a query on SQLite
 */
async function executeSQLiteQuery(
  db: BetterSqlite3.Database,
  query: string,
  params: unknown[]
): Promise<ExecuteQueryResult> {
  try {
    const stmt = db.prepare(query);
    
    // Determine if this is a SELECT query
    const trimmedQuery = query.trim().toUpperCase();
    const isSelect = trimmedQuery.startsWith("SELECT");
    
    if (isSelect) {
      const rows = stmt.all(...params) as unknown[];
      
      // Get column names from first row or from statement
      let columns: string[] = [];
      if (rows.length > 0 && rows[0] && typeof rows[0] === 'object') {
        columns = Object.keys(rows[0] as Record<string, unknown>);
      }
      
      return {
        rows,
        rowCount: rows.length,
        columns
      };
    } else {
      // For non-SELECT queries (INSERT, UPDATE, DELETE, etc.)
      const info = stmt.run(...params);
      
      return {
        rows: [],
        rowCount: info.changes || 0,
        columns: []
      };
    }
  } catch (error) {
    throw new Error(`SQLite query error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Executes a query on IBM DB2
 */
async function executeDB2Query(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conn: any,
  query: string,
  params: unknown[]
): Promise<ExecuteQueryResult> {
  try {
    const rows: unknown[] = await conn.query(query, params.length > 0 ? params : undefined);

    const columns = rows.length > 0 && rows[0] && typeof rows[0] === "object"
      ? Object.keys(rows[0] as Record<string, unknown>)
      : [];

    return {
      rows,
      rowCount: rows.length,
      columns
    };
  } catch (error) {
    throw new Error(`IBM DB2 query error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Formats query results as markdown table
 */
export function formatResultsAsMarkdown(
  rows: unknown[],
  columns?: string[]
): string {
  if (rows.length === 0) {
    return "No results found.";
  }
  
  // Extract columns from first row if not provided
  const actualColumns = columns || (rows[0] && typeof rows[0] === 'object' 
    ? Object.keys(rows[0] as Record<string, unknown>)
    : []);
  
  if (actualColumns.length === 0) {
    return "No columns found.";
  }
  
  // Build markdown table
  const lines: string[] = [];
  
  // Header
  lines.push("| " + actualColumns.join(" | ") + " |");
  lines.push("| " + actualColumns.map(() => "---").join(" | ") + " |");
  
  // Rows
  for (const row of rows) {
    if (row && typeof row === 'object') {
      const rowObj = row as Record<string, unknown>;
      const values = actualColumns.map(col => {
        const value = rowObj[col];
        if (value === null || value === undefined) {
          return "NULL";
        }
        if (typeof value === 'object') {
          return JSON.stringify(value);
        }
        return String(value);
      });
      lines.push("| " + values.join(" | ") + " |");
    }
  }
  
  return lines.join("\n");
}

/**
 * Formats query results as JSON
 */
export function formatResultsAsJSON(
  rows: unknown[],
  rowCount: number,
  columns?: string[]
): string {
  const result = {
    rowCount,
    columns: columns || (rows[0] && typeof rows[0] === 'object' 
      ? Object.keys(rows[0] as Record<string, unknown>)
      : []),
    rows
  };
  
  return JSON.stringify(result, null, 2);
}
