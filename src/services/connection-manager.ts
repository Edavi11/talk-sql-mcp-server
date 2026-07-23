/**
 * Connection Manager for SQL databases
 * Handles connection pooling and database type detection
 */

import pg from "pg";
import mysql from "mysql2/promise";
import sql from "mssql";
import { DatabaseType, DatabaseConnection } from "../types.js";

const { Pool: PgPool } = pg;

export interface ConnectionPool {
  type: DatabaseType;
  pool: unknown;
  close: () => Promise<void>;
  cacheKey?: string;
}

/**
 * Detects database type from connection string
 */
export function detectDatabaseType(connectionString: string): DatabaseType {
  const lower = connectionString.toLowerCase().trim();

  if (lower.startsWith("cockroachdb://")) {
    return DatabaseType.COCKROACHDB;
  }

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

  if (lower.startsWith("db2://") || lower.startsWith("ibmdb2://")) {
    return DatabaseType.DB2;
  }

  // SQLite file path (no protocol)
  if (lower.endsWith(".db") || lower.endsWith(".sqlite") || lower.endsWith(".sqlite3")) {
    return DatabaseType.SQLITE;
  }

  throw new Error(`Unsupported database type. Connection string must start with: postgresql://, cockroachdb://, mysql://, mssql://, sqlite://, or db2://`);
}

/**
 * Creates a connection pool for PostgreSQL or CockroachDB.
 * CockroachDB speaks the PostgreSQL wire protocol, so the `pg` driver works
 * against it unmodified - only the reported `type` differs.
 */
async function createPostgreSQLPool(connectionString: string, dbType: DatabaseType.POSTGRESQL | DatabaseType.COCKROACHDB): Promise<ConnectionPool> {
  // CockroachDB connection strings use a cockroachdb:// scheme that the pg
  // driver doesn't recognize - rewrite to postgresql:// before connecting.
  const pgConnectionString = dbType === DatabaseType.COCKROACHDB
    ? connectionString.replace(/^cockroachdb:\/\//i, "postgresql://")
    : connectionString;

  const pool = new PgPool({
    connectionString: pgConnectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  const label = dbType === DatabaseType.COCKROACHDB ? "CockroachDB" : "PostgreSQL";

  // Test connection
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    await pool.end();
    throw new Error(`Failed to connect to ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    type: dbType,
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
    const { default: Database } = await import("better-sqlite3");
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
 * Creates a connection for IBM DB2
 * Uses ibm_db (optional dependency — lazy loaded)
 */
async function createDB2Connection(connectionString: string): Promise<ConnectionPool> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ibmdb: any;
  try {
    const mod = await import("ibm_db");
    // ibm_db is a CJS module; when imported via ESM dynamic import it may be wrapped in .default
    ibmdb = (mod.default && typeof mod.default.open === "function") ? mod.default : mod;
  } catch {
    throw new Error(
      "ibm_db package is not installed. Install it with: npm install ibm_db\n" +
      "Note: ibm_db requires the IBM ODBC CLI driver which is downloaded automatically on first install."
    );
  }

  // Parse db2://user:password@host:port/database into ODBC connection string
  const url = new URL(connectionString);
  const database = url.pathname.slice(1); // remove leading /
  const hostname = url.hostname;
  const port = url.port || "50000";
  const uid = decodeURIComponent(url.username);
  const pwd = decodeURIComponent(url.password);

  const odbcConnStr =
    `DATABASE=${database};HOSTNAME=${hostname};PORT=${port};` +
    `UID=${uid};PWD=${pwd};PROTOCOL=TCPIP`;

  try {
    const conn = await ibmdb.open(odbcConnStr);

    return {
      type: DatabaseType.DB2,
      pool: conn,
      close: async () => {
        await conn.close();
      }
    };
  } catch (error) {
    throw new Error(
      `Failed to connect to IBM DB2: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Creates a connection pool based on connection string
 */
export async function createConnectionPool(connectionString: string): Promise<ConnectionPool> {
  const dbType = detectDatabaseType(connectionString);

  switch (dbType) {
    case DatabaseType.POSTGRESQL:
    case DatabaseType.COCKROACHDB:
      return createPostgreSQLPool(connectionString, dbType);
    case DatabaseType.MYSQL:
      return createMySQLPool(connectionString);
    case DatabaseType.SQLSERVER:
      return createSQLServerPool(connectionString);
    case DatabaseType.SQLITE:
      return createSQLiteConnection(connectionString);
    case DatabaseType.DB2:
      return createDB2Connection(connectionString);
    default:
      throw new Error(`Unsupported database type: ${dbType}`);
  }
}

/**
 * Validates table/column/schema identifiers to prevent SQL injection.
 * Allows letters, digits, and underscores, with optional dot-separated
 * schema.table segments. Throws on anything else instead of silently
 * stripping invalid characters.
 */
export function sanitizeIdentifier(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(identifier)) {
    throw new Error(
      `Invalid SQL identifier: "${identifier}". Identifiers must start with a letter or underscore and contain only letters, digits, and underscores, with optional single-dot schema.table separators.`
    );
  }
  return identifier;
}
