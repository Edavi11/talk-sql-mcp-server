/**
 * Connection Manager for SQL databases
 * Handles connection pooling and database type detection
 */

import pg from "pg";
import mysql from "mysql2/promise";
import sql from "mssql";
import Database from "better-sqlite3";
import { DatabaseType, DatabaseConnection } from "../types.js";

const { Pool: PgPool } = pg;

export interface ConnectionPool {
  type: DatabaseType;
  pool: unknown;
  close: () => Promise<void>;
}

/**
 * Detects database type from connection string
 */
export function detectDatabaseType(connectionString: string): DatabaseType {
  const lower = connectionString.toLowerCase().trim();
  
  if (lower.startsWith("postgresql://") || lower.startsWith("postgres://")) {
    return DatabaseType.POSTGRESQL;
  }
  
  if (lower.startsWith("mysql://") || lower.startsWith("mysql2://")) {
    return DatabaseType.MYSQL;
  }
  
  if (lower.startsWith("mssql://") || lower.startsWith("sqlserver://") || lower.startsWith("sql://")) {
    return DatabaseType.SQLSERVER;
  }
  
  if (lower.startsWith("sqlite://") || lower.startsWith("sqlite:")) {
    return DatabaseType.SQLITE;
  }
  
  // SQLite file path (no protocol)
  if (lower.endsWith(".db") || lower.endsWith(".sqlite") || lower.endsWith(".sqlite3")) {
    return DatabaseType.SQLITE;
  }
  
  throw new Error(`Unsupported database type. Connection string must start with: postgresql://, mysql://, mssql://, or sqlite://`);
}

/**
 * Creates a connection pool for PostgreSQL
 */
async function createPostgreSQLPool(connectionString: string): Promise<ConnectionPool> {
  const pool = new PgPool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  
  // Test connection
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    await pool.end();
    throw new Error(`Failed to connect to PostgreSQL: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return {
    type: DatabaseType.POSTGRESQL,
    pool,
    close: async () => {
      await pool.end();
    }
  };
}

/**
 * Creates a connection pool for MySQL
 */
async function createMySQLPool(connectionString: string): Promise<ConnectionPool> {
  const pool = mysql.createPool(connectionString);
  
  // Test connection
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    await pool.end();
    throw new Error(`Failed to connect to MySQL: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return {
    type: DatabaseType.MYSQL,
    pool,
    close: async () => {
      await pool.end();
    }
  };
}

/**
 * Creates a connection pool for SQL Server
 */
async function createSQLServerPool(connectionString: string): Promise<ConnectionPool> {
  // Parse connection string for SQL Server
  // mssql://user:password@host:port/database?encrypt=false&trustServerCertificate=true
  const url = new URL(connectionString);
  
  // Parse query parameters for options
  const encryptParam = url.searchParams.get("encrypt");
  const trustServerCertParam = url.searchParams.get("trustServerCertificate");
  
  const config: sql.config = {
    user: url.username,
    password: url.password,
    server: url.hostname,
    port: parseInt(url.port || "1433"),
    database: url.pathname.slice(1), // Remove leading /
    options: {
      encrypt: encryptParam !== null ? encryptParam === "true" : false,
      trustServerCertificate: trustServerCertParam !== null ? trustServerCertParam === "true" : true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
  
  const pool = new sql.ConnectionPool(config);
  
  // Test connection
  try {
    await pool.connect();
  } catch (error) {
    throw new Error(`Failed to connect to SQL Server: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return {
    type: DatabaseType.SQLSERVER,
    pool,
    close: async () => {
      await pool.close();
    }
  };
}

/**
 * Creates a connection for SQLite
 */
async function createSQLiteConnection(connectionString: string): Promise<ConnectionPool> {
  // Extract file path from connection string
  // sqlite:///path/to/file.db or sqlite:/path/to/file.db or just path/to/file.db
  let filePath: string;
  
  if (connectionString.startsWith("sqlite://")) {
    filePath = connectionString.replace("sqlite://", "");
  } else if (connectionString.startsWith("sqlite:")) {
    filePath = connectionString.replace("sqlite:", "");
  } else {
    filePath = connectionString;
  }
  
  // Remove leading slash if present (sqlite:/// becomes /)
  if (filePath.startsWith("/") && !filePath.startsWith("//")) {
    filePath = filePath.slice(1);
  }
  
  try {
    const db = new Database(filePath);
    
    // Test connection
    db.prepare("SELECT 1").get();
    
    return {
      type: DatabaseType.SQLITE,
      pool: db,
      close: async () => {
        db.close();
      }
    };
  } catch (error) {
    throw new Error(`Failed to connect to SQLite: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Creates a connection pool based on connection string
 */
export async function createConnectionPool(connectionString: string): Promise<ConnectionPool> {
  const dbType = detectDatabaseType(connectionString);
  
  switch (dbType) {
    case DatabaseType.POSTGRESQL:
      return createPostgreSQLPool(connectionString);
    case DatabaseType.MYSQL:
      return createMySQLPool(connectionString);
    case DatabaseType.SQLSERVER:
      return createSQLServerPool(connectionString);
    case DatabaseType.SQLITE:
      return createSQLiteConnection(connectionString);
    default:
      throw new Error(`Unsupported database type: ${dbType}`);
  }
}

/**
 * Sanitizes table/column names to prevent SQL injection
 * Allows alphanumeric, underscore, hyphen, and dot (for schema.table notation)
 */
export function sanitizeIdentifier(identifier: string): string {
  // Allow alphanumeric, underscore, hyphen, and dot (used in schema.table)
  // Strip anything else to prevent injection
  return identifier.replace(/[^a-zA-Z0-9_\-.]/g, "");
}
