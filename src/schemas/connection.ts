/**
 * Zod schemas for connection string validation
 */

import { z } from "zod";

export const ConnectionStringSchema = z.string()
  .min(1, "Connection string is required")
  .max(500, "Connection string is too long")
  .optional()
  .describe("Database connection string (e.g., postgresql://user:pass@host:port/db). If not provided, uses SQL_CONNECTION_STRING environment variable.");

export const ResponseFormatSchema = z.enum(["markdown", "json"])
  .default("markdown")
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

export const DatabaseNameSchema = z.string()
  .min(1, "Database name is required")
  .max(100, "Database name is too long")
  .regex(/^[a-zA-Z0-9_]+$/, "Database name contains invalid characters")
  .optional()
  .describe("Database name (optional, uses connection string database if not provided)");

export const SchemaNameSchema = z.string()
  .min(1, "Schema name is required")
  .max(100, "Schema name is too long")
  .regex(/^[a-zA-Z0-9_]+$/, "Schema name contains invalid characters")
  .optional()
  .describe("Schema name (optional, uses default schema if not provided)");

export const TableNameSchema = z.string()
  .min(1, "Table name is required")
  .max(100, "Table name is too long")
  .regex(/^[a-zA-Z0-9_]+$/, "Table name contains invalid characters")
  .describe("Table name");

export const ColumnNameSchema = z.string()
  .min(1, "Column name is required")
  .max(100, "Column name is too long")
  .regex(/^[a-zA-Z0-9_]+$/, "Column name contains invalid characters");

export const QuerySchema = z.string()
  .min(1, "Query is required")
  .max(100000, "Query is too long")
  .describe("SQL query to execute");

export const LimitSchema = z.number()
  .int("Limit must be an integer")
  .min(1, "Limit must be at least 1")
  .max(1000, "Limit cannot exceed 1000")
  .default(100)
  .describe("Maximum number of results to return");

export const OffsetSchema = z.number()
  .int("Offset must be an integer")
  .min(0, "Offset cannot be negative")
  .default(0)
  .describe("Number of results to skip for pagination");

export const WhereClauseSchema = z.string()
  .max(5000, "WHERE clause is too long")
  .optional()
  .describe("SQL WHERE clause (without the WHERE keyword, e.g., 'age > 18')");

export const ColumnsSchema = z.array(ColumnNameSchema)
  .optional()
  .describe("Array of column names to select (if not provided, selects all columns)");
