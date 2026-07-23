/**
 * SQL query classification and WHERE-fragment validation
 * Uses node-sql-parser (real AST parsing) with a conservative regex fallback
 * for dialect edge cases the parser can't handle.
 */

import pkg from "node-sql-parser";
import { DatabaseType } from "../types.js";

const { Parser } = pkg;
const parser = new Parser();

export type QueryClassification = {
  type: "SELECT" | "DML" | "DDL" | "OTHER";
  isDestructive: boolean;
  hasWhere: boolean;
  tables: string[];
  parseError?: string;
};

function mapDialect(dbType: DatabaseType): string {
  switch (dbType) {
    case DatabaseType.POSTGRESQL: return "PostgresQL";
    case DatabaseType.MYSQL: return "MySQL";
    case DatabaseType.SQLSERVER: return "TransactSQL";
    case DatabaseType.SQLITE: return "Sqlite";
    case DatabaseType.DB2: return "DB2";
  }
}

function classifyStatement(stmt: { type: string; where?: unknown }): Omit<QueryClassification, "parseError"> {
  const hasWhere = stmt.where !== null && stmt.where !== undefined;

  switch (stmt.type) {
    case "select":
      return { type: "SELECT", isDestructive: false, hasWhere, tables: [] };
    case "insert":
      return { type: "DML", isDestructive: false, hasWhere, tables: [] };
    case "update":
    case "delete":
      return { type: "DML", isDestructive: !hasWhere, hasWhere, tables: [] };
    case "drop":
    case "truncate":
      return { type: "DDL", isDestructive: true, hasWhere: false, tables: [] };
    case "create":
    case "alter":
      return { type: "DDL", isDestructive: false, hasWhere: false, tables: [] };
    default:
      return { type: "OTHER", isDestructive: false, hasWhere: false, tables: [] };
  }
}

function classifyWithRegexFallback(sql: string, parseErrorMsg: string): QueryClassification {
  const trimmed = sql.trim().toUpperCase();
  const first = trimmed.split(/\s+/)[0];
  const hasWhere = /\bWHERE\b/.test(trimmed);

  if (first === "SELECT" || first === "WITH") {
    return { type: "SELECT", isDestructive: false, hasWhere, tables: [], parseError: parseErrorMsg };
  }
  if (first === "DROP" || first === "TRUNCATE") {
    return { type: "DDL", isDestructive: true, hasWhere: false, tables: [], parseError: parseErrorMsg };
  }
  if (first === "CREATE" || first === "ALTER") {
    return { type: "DDL", isDestructive: false, hasWhere: false, tables: [], parseError: parseErrorMsg };
  }
  if (first === "UPDATE" || first === "DELETE") {
    return { type: "DML", isDestructive: !hasWhere, hasWhere, tables: [], parseError: parseErrorMsg };
  }
  if (first === "INSERT") {
    return { type: "DML", isDestructive: false, hasWhere: false, tables: [], parseError: parseErrorMsg };
  }
  return { type: "OTHER", isDestructive: true, hasWhere: false, tables: [], parseError: parseErrorMsg };
}

export function classifyQuery(sql: string, dbType: DatabaseType): QueryClassification {
  try {
    const ast = parser.astify(sql, { database: mapDialect(dbType) });
    const statements = Array.isArray(ast) ? ast : [ast];
    if (statements.length === 0) {
      return classifyWithRegexFallback(sql, "Empty statement list");
    }
    // Multiple statements (stacked via ;) - classify by the most destructive statement present
    const classifications = statements.map(s => classifyStatement(s as { type: string; where?: unknown }));
    const mostDestructive = classifications.find(c => c.isDestructive) ?? classifications[0];
    const tables = extractTableList(sql, dbType);
    return { ...mostDestructive, tables };
  } catch (err) {
    return classifyWithRegexFallback(sql, err instanceof Error ? err.message : String(err));
  }
}

function extractTableList(sql: string, dbType: DatabaseType): string[] {
  try {
    const { tableList } = parser.parse(sql, { database: mapDialect(dbType) });
    // tableList entries look like "select::null::table_name" - keep just the table name
    return tableList.map(t => t.split("::").pop() ?? t);
  } catch {
    return [];
  }
}

export function validateWhereFragment(whereFragment: string, dbType: DatabaseType): { valid: boolean; error?: string } {
  const baseTable = "__talksql_validate__";
  const synthetic = `SELECT * FROM ${baseTable} WHERE ${whereFragment}`;

  let ast;
  try {
    ast = parser.astify(synthetic, { database: mapDialect(dbType) });
  } catch (err) {
    return { valid: false, error: `WHERE clause is not valid SQL: ${err instanceof Error ? err.message : String(err)}` };
  }

  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) {
    return { valid: false, error: "WHERE clause must not contain multiple statements" };
  }

  const stmt = statements[0] as { type: string };
  if (stmt.type !== "select") {
    return { valid: false, error: "WHERE clause did not parse as part of a single SELECT statement" };
  }

  const referencedTables = extractTableList(synthetic, dbType).filter(t => t !== baseTable);
  if (referencedTables.length > 0) {
    return { valid: false, error: `WHERE clause must not reference other tables (found: ${referencedTables.join(", ")})` };
  }

  return { valid: true };
}
