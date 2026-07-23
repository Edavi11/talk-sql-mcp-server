/**
 * TypeScript type definitions for SQL MCP Server
 */

export enum DatabaseType {
  POSTGRESQL = "postgresql",
  MYSQL = "mysql",
  SQLSERVER = "mssql",
  SQLITE = "sqlite",
  DB2 = "db2",
  COCKROACHDB = "cockroachdb"
}

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json"
}

export interface DatabaseConnection {
  type: DatabaseType;
  connectionString: string;
}

export interface QueryResult {
  rows: unknown[];
  rowCount?: number;
  columns?: string[];
}

export interface PaginatedResult {
  total?: number;
  count: number;
  offset: number;
  limit: number;
  data: unknown[];
  has_more: boolean;
  next_offset?: number;
}

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable?: boolean;
  primary_key?: boolean;
  unique?: boolean;
  default?: string;
  auto_increment?: boolean;
}

export interface ForeignKeyDefinition {
  column: string;
  references_table: string;
  references_column: string;
  on_delete?: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";
  on_update?: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";
}

export enum TriggerTiming {
  BEFORE = "BEFORE",
  AFTER = "AFTER"
}

export enum TriggerEvent {
  INSERT = "INSERT",
  UPDATE = "UPDATE",
  DELETE = "DELETE"
}

export interface SshConfig {
  host: string;
  port?: number;
  username: string;
  privateKeyPath?: string;
  password?: string;
}

export interface NamedConnection {
  name: string;
  connectionString: string;
  ssh?: SshConfig;
}

export interface ResolvedConnection {
  connectionString: string;
  cleanup: () => Promise<void>;
}
