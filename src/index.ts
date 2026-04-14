#!/usr/bin/env node
/**
 * talk-sql MCP Server
 *
 * MCP server for interacting with SQL databases (PostgreSQL, MySQL, SQL Server, SQLite)
 * Supports listing databases/schemas, executing SQL, creating tables/relations/triggers
 *
 * Connection modes:
 *   - TALK_SQL_CONFIG: path to a JSON config file with named connections (recommended)
 *   - SQL_CONNECTION_STRING: single connection string (legacy)
 *   - connection_string param: pass inline per tool call
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";

// Import tools
import { testConnection, TestConnectionInputSchema } from "./tools/database-tools.js";
import { listDatabases, ListDatabasesInputSchema } from "./tools/database-tools.js";
import { listSchemas, ListSchemasInputSchema } from "./tools/database-tools.js";
import { listConnections, ListConnectionsInputSchema } from "./tools/database-tools.js";
import { executeSQL, ExecuteSQLInputSchema } from "./tools/query-tools.js";
import { selectData, SelectDataInputSchema } from "./tools/query-tools.js";
import { createTable, CreateTableInputSchema } from "./tools/ddl-tools.js";
import { createRelation, CreateRelationInputSchema } from "./tools/ddl-tools.js";
import { createTrigger, CreateTriggerInputSchema } from "./tools/trigger-tools.js";

// Create MCP server instance
const server = new McpServer({
  name: "talk-sql",
  version: "1.0.0"
});

// Register db_list_connections tool
server.registerTool(
  "db_list_connections",
  {
    title: "List Configured Connections",
    description: `List all named database connections configured in the talk-sql config file.

Use this tool first when you are unsure which connection to use, or to discover available connection names before calling other db_* tools.

Returns each connection's name, database type, and whether it uses an SSH tunnel.
Passwords and full connection strings are never exposed.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  {
    "connections": [
      { "name": string, "type": string, "has_ssh": boolean }
    ],
    "total": number,
    "note": string
  }

Setup:
  Set TALK_SQL_CONFIG to the path of your JSON config file:
  [
    { "name": "local", "connectionString": "postgresql://user:pass@localhost:5432/db" },
    { "name": "remote", "connectionString": "postgresql://user:pass@server:5432/db" }
  ]`,
    inputSchema: ListConnectionsInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => {
    return await listConnections(params);
  }
);

// Register db_ping tool
server.registerTool(
  "db_ping",
  {
    title: "Test Database Connection",
    description: `Test connectivity to the database and return server info.

ALWAYS use this tool first if any other db_* tool returns a connection error, or if you are unsure whether the connection string is correct. It helps diagnose and recover from connection failures before retrying.

Args:
  - connection_name (string, optional): Name of a pre-configured connection (from TALK_SQL_CONFIG). Use db_list_connections to see available names.
  - connection_string (string, optional): Database connection string. Used if connection_name is not provided.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

If neither connection_name nor connection_string is provided, falls back to SQL_CONNECTION_STRING environment variable or the only configured connection in TALK_SQL_CONFIG.

Returns:
  On success:
  { "success": true, "database_type": string, "latency_ms": number, "server_version": string }

  On failure:
  { "success": false, "database_type": string, "error": string, "advice": string }
  The "advice" field contains specific steps to fix the connection.

Recovery guide:
  - If error mentions password/authentication -> check credentials in connection string
  - If error mentions ECONNREFUSED or timeout -> check host, port, and that the server is running
  - If error mentions database does not exist -> use db_list_databases with a valid db connection
  - If error mentions SSL/certificate -> add ?trustServerCertificate=true to connection string
  - After fixing the connection string, call db_ping again to verify before retrying`,
    inputSchema: TestConnectionInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params) => {
    return await testConnection(params);
  }
);

// Register db_list_databases tool
server.registerTool(
  "db_list_databases",
  {
    title: "List Databases",
    description: `List all databases available in the database server.

This tool connects to the database server using the provided connection and returns a list of all available databases. It works with PostgreSQL, MySQL, SQL Server, and SQLite.

Args:
  - connection_name (string, optional): Name of a pre-configured connection (from TALK_SQL_CONFIG). Use db_list_connections to see available names.
  - connection_string (string, optional): Database connection string (e.g., postgresql://user:pass@host:port/db). Used if connection_name is not provided.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

If neither connection_name nor connection_string is provided, falls back to SQL_CONNECTION_STRING environment variable or the only configured connection in TALK_SQL_CONFIG.

Returns:
  For JSON format: Structured data with schema:
  {
    "total": number,           // Total number of databases
    "databases": [             // Array of database objects
      {
        "name": string         // Database name
      }
    ]
  }

Examples:
  - Use when: "Show me all databases" -> params with connection_name
  - Use when: "List databases in PostgreSQL" -> params with postgresql:// connection string

Error Handling:
  - If this tool returns a connection error, use db_ping first to verify and fix the connection
  - If permission error, the user may need to grant LIST privileges
  - Never use docker exec or external commands to interact with the database — always retry with corrected parameters`,
    inputSchema: ListDatabasesInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params) => {
    return await listDatabases(params);
  }
);

// Register db_list_tables tool
server.registerTool(
  "db_list_tables",
  {
    title: "List Schemas and Tables",
    description: `List all schemas and their tables in a database.

This tool connects to the database and returns information about all schemas and the tables within each schema. For databases without schema support (like SQLite), it returns tables in the main/default schema.

Args:
  - connection_name (string, optional): Name of a pre-configured connection (from TALK_SQL_CONFIG). Use db_list_connections to see available names.
  - connection_string (string, optional): Database connection string. Used if connection_name is not provided.
  - database (string, optional): Specific database name (optional, uses connection string database if not provided)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

If neither connection_name nor connection_string is provided, falls back to SQL_CONNECTION_STRING environment variable or the only configured connection in TALK_SQL_CONFIG.

Returns:
  For JSON format: Structured data with schema:
  {
    "schemas": [
      {
        "schema_name": string,    // Schema name
        "table_count": number,     // Number of tables in schema
        "tables": [                // Array of table objects
          {
            "table_name": string,  // Table name
            "table_type": string   // Table type (BASE TABLE, VIEW, etc.)
          }
        ]
      }
    ]
  }

Examples:
  - Use when: "Show me all tables" -> params with connection_name
  - Use when: "List schemas in my database" -> params with connection_name and optional database

Error Handling:
  - If this tool returns a connection error, use db_ping first to verify and fix the connection
  - If the database is not found, use db_list_databases to get a valid database name
  - Never use docker exec or external commands to interact with the database — always retry with corrected parameters`,
    inputSchema: ListSchemasInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params) => {
    return await listSchemas(params);
  }
);

// Register db_query tool
server.registerTool(
  "db_query",
  {
    title: "Execute SQL Query",
    description: `Execute any SQL query against the database.

This tool can execute SELECT, INSERT, UPDATE, DELETE, and DDL statements. It returns results for SELECT queries or confirmation for DML/DDL operations.

Args:
  - connection_name (string, optional): Name of a pre-configured connection (from TALK_SQL_CONFIG). Use db_list_connections to see available names.
  - connection_string (string, optional): Database connection string. Used if connection_name is not provided.
  - query (string): SQL query to execute (max 100,000 characters)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

If neither connection_name nor connection_string is provided, falls back to SQL_CONNECTION_STRING environment variable or the only configured connection in TALK_SQL_CONFIG.

Returns:
  For SELECT queries (JSON format):
  {
    "rowCount": number,        // Number of rows returned
    "columns": string[],       // Column names
    "rows": unknown[]          // Array of row objects
  }

  For DML/DDL queries (JSON format):
  {
    "success": boolean,         // Whether query succeeded
    "rowCount": number,        // Number of rows affected
    "message": string          // Success message
  }

Examples:
  - Use when: "Run SELECT * FROM users" -> params with query="SELECT * FROM users"
  - Use when: "Create a new user" -> params with INSERT query
  - Don't use when: You need pagination (use db_select instead)

Error Handling:
  - If connection error: use db_ping to diagnose, then retry with the fixed connection string
  - If syntax error: fix the SQL query and retry — do NOT fall back to docker or shell commands
  - If table not found: use db_list_tables to verify the table name, then retry
  - If permission error: the database user lacks privileges — do not try to bypass via docker
  - Always retry using this tool before giving up`,
    inputSchema: ExecuteSQLInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params) => {
    return await executeSQL(params);
  }
);

// Register db_select tool
server.registerTool(
  "db_select",
  {
    title: "Select Data from Table",
    description: `Select data from a table with pagination and filtering.

This tool provides a convenient way to query table data with built-in pagination, column selection, and WHERE clause support. It automatically handles pagination metadata.

Args:
  - connection_name (string, optional): Name of a pre-configured connection (from TALK_SQL_CONFIG). Use db_list_connections to see available names.
  - connection_string (string, optional): Database connection string. Used if connection_name is not provided.
  - table (string): Table name to query
  - schema (string, optional): Schema name (optional, uses default schema if not provided)
  - columns (string[], optional): Array of column names to select (if not provided, selects all columns)
  - where (string, optional): SQL WHERE clause without the WHERE keyword (e.g., "age > 18")
  - limit (number, optional): Maximum results to return (default: 100, max: 1000)
  - offset (number, optional): Number of results to skip (default: 0)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

If neither connection_name nor connection_string is provided, falls back to SQL_CONNECTION_STRING environment variable or the only configured connection in TALK_SQL_CONFIG.

Returns:
  For JSON format: Paginated result with schema:
  {
    "total": number,           // Total number of rows (if available)
    "count": number,           // Number of rows in this response
    "offset": number,          // Current pagination offset
    "limit": number,           // Current limit
    "data": unknown[],         // Array of row objects
    "has_more": boolean,       // Whether more results are available
    "next_offset": number      // Offset for next page (if has_more is true)
  }

Examples:
  - Use when: "Show me first 10 users" -> params with table="users", limit=10
  - Use when: "Get active users" -> params with table="users", where="active = true"
  - Use when: "Show name and email from users" -> params with table="users", columns=["name", "email"]

Error Handling:
  - If connection error: use db_ping to diagnose, then retry
  - If table not found: use db_list_tables to confirm the table name, then retry
  - If column error: omit the columns parameter to select all columns, then retry
  - If WHERE clause error: simplify or remove the where parameter, then retry
  - Never use docker exec or external shell commands — always retry with corrected parameters`,
    inputSchema: SelectDataInputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params) => {
    return await selectData(params);
  }
);

// Register db_create_table tool
server.registerTool(
  "db_create_table",
  {
    title: "Create Table",
    description: `Create a new table with columns and constraints.

This tool creates a table with the specified columns, data types, and constraints (primary keys, unique, nullable, defaults, auto-increment).

Args:
  - connection_name (string, optional): Name of a pre-configured connection (from TALK_SQL_CONFIG). Use db_list_connections to see available names.
  - connection_string (string, optional): Database connection string. Used if connection_name is not provided.
  - schema (string, optional): Schema name (optional, uses default schema if not provided)
  - table (string): Table name to create
  - columns (array): Array of column definitions, each with:
    - name (string): Column name
    - type (string): SQL data type (e.g., VARCHAR(255), INT, TIMESTAMP)
    - nullable (boolean, optional): Whether column allows NULL (default: true)
    - primary_key (boolean, optional): Whether column is primary key
    - unique (boolean, optional): Whether column has unique constraint
    - default (string, optional): Default value
    - auto_increment (boolean, optional): Whether column auto-increments
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

If neither connection_name nor connection_string is provided, falls back to SQL_CONNECTION_STRING environment variable or the only configured connection in TALK_SQL_CONFIG.

Returns:
  For JSON format:
  {
    "success": boolean,         // Whether table was created
    "message": string,          // Success message
    "table": string,            // Full table name (schema.table)
    "columns": number,          // Number of columns
    "query": string             // SQL query executed
  }

Examples:
  - Use when: "Create users table" -> params with table="users" and columns array
  - Use when: "Create table with primary key" -> params with primary_key=true in column

Error Handling:
  - If connection error: use db_ping to diagnose, then retry
  - If table already exists: use db_query with DROP TABLE IF EXISTS before creating, or change the table name
  - If column type error: check the supported types for the target database and retry
  - Never use docker exec or external commands — always retry using this tool`,
    inputSchema: CreateTableInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params) => {
    return await createTable(params);
  }
);

// Register db_create_relation tool
server.registerTool(
  "db_create_relation",
  {
    title: "Create Foreign Key Relations",
    description: `Create foreign key relationships between tables.

This tool adds foreign key constraints to link columns in one table to columns in another table, with optional ON DELETE and ON UPDATE actions.

Args:
  - connection_name (string, optional): Name of a pre-configured connection (from TALK_SQL_CONFIG). Use db_list_connections to see available names.
  - connection_string (string, optional): Database connection string. Used if connection_name is not provided.
  - schema (string, optional): Schema name (optional, uses default schema if not provided)
  - table (string): Table name to add foreign keys to
  - foreign_keys (array): Array of foreign key definitions, each with:
    - column (string): Column name in the table
    - references_table (string): Referenced table name
    - references_column (string): Referenced column name
    - on_delete ('CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION', optional): Action on delete
    - on_update ('CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION', optional): Action on update
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

If neither connection_name nor connection_string is provided, falls back to SQL_CONNECTION_STRING environment variable or the only configured connection in TALK_SQL_CONFIG.

Returns:
  For JSON format:
  {
    "success": boolean,              // Whether all foreign keys were created
    "message": string,               // Status message
    "table": string,                 // Full table name
    "foreign_keys_created": number,   // Number successfully created
    "total_foreign_keys": number,    // Total number attempted
    "queries": string[]              // SQL queries executed
  }

Examples:
  - Use when: "Link users to orders" -> params with foreign_keys linking user_id
  - Use when: "Create cascade delete" -> params with on_delete="CASCADE"

Error Handling:
  - If referenced table does not exist: use db_list_tables to verify the table name, then retry
  - If constraint already exists: use db_query to drop the constraint first, then retry
  - If connection error: use db_ping, then retry
  - Never use docker exec or external commands`,
    inputSchema: CreateRelationInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params) => {
    return await createRelation(params);
  }
);

// Register db_create_trigger tool
server.registerTool(
  "db_create_trigger",
  {
    title: "Create Trigger",
    description: `Create a database trigger on a table.

This tool creates a trigger that executes SQL code before or after INSERT, UPDATE, or DELETE operations on a table. The trigger syntax is automatically adapted to the database type.

Args:
  - connection_name (string, optional): Name of a pre-configured connection (from TALK_SQL_CONFIG). Use db_list_connections to see available names.
  - connection_string (string, optional): Database connection string. Used if connection_name is not provided.
  - schema (string, optional): Schema name (optional, uses default schema if not provided)
  - table (string): Table name to create trigger on
  - trigger_name (string): Name for the trigger
  - timing ('BEFORE' | 'AFTER'): When trigger executes
  - event ('INSERT' | 'UPDATE' | 'DELETE'): Event that fires trigger
  - procedure (string): SQL code for trigger body (max 10,000 characters)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

If neither connection_name nor connection_string is provided, falls back to SQL_CONNECTION_STRING environment variable or the only configured connection in TALK_SQL_CONFIG.

Returns:
  For JSON format:
  {
    "success": boolean,         // Whether trigger was created
    "message": string,          // Success message
    "trigger_name": string,     // Trigger name
    "table": string,           // Full table name
    "timing": string,          // BEFORE or AFTER
    "event": string,           // INSERT, UPDATE, or DELETE
    "query": string            // SQL query executed
  }

Examples:
  - Use when: "Create audit trigger" -> params with procedure that logs changes
  - Use when: "Validate before insert" -> params with timing="BEFORE", event="INSERT"

Error Handling:
  - If syntax error in procedure: fix the trigger body and retry — syntax varies by database type (PostgreSQL, MySQL, SQL Server)
  - If trigger already exists: use db_query to DROP the trigger first, then retry
  - If connection error: use db_ping, then retry
  - Never use docker exec or external commands`,
    inputSchema: CreateTriggerInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params) => {
    return await createTrigger(params);
  }
);

// Main function for stdio transport
async function runStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("talk-sql MCP server running via stdio");
}

// Main function for HTTP transport
async function runHTTP() {
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req: Request, res: Response) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT || '3000');
  app.listen(port, () => {
    console.error(`talk-sql MCP server running on http://localhost:${port}/mcp`);
  });
}

// Choose transport based on environment
const transport = process.env.TRANSPORT || 'stdio';
if (transport === 'http') {
  runHTTP().catch(error => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch(error => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
