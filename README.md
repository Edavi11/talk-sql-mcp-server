# 🗄️ talk-sql

**talk-sql** is a **Model Context Protocol (MCP)** server that gives AI assistants (Cursor, Claude, Copilot, etc.) full, native SQL database access — without resorting to Docker commands or shell workarounds.

Supports **PostgreSQL**, **MySQL**, **SQL Server**, and **SQLite** through a unified set of tools.

---

## ✨ Features

| Capability | Tool |
|---|---|
| 🔌 Test & diagnose connection | `db_ping` |
| 🗂️ List all databases | `db_list_databases` |
| 📋 List schemas and tables | `db_list_tables` |
| ⚡ Execute any SQL query | `db_query` |
| 📄 Select data with pagination | `db_select` |
| 🏗️ Create tables | `db_create_table` |
| 🔗 Create foreign key relations | `db_create_relation` |
| ⚙️ Create triggers | `db_create_trigger` |

**Supports:** PostgreSQL · MySQL · SQL Server · SQLite

---

## 📦 Installation

### Option 1 — npx (no install required)

Run directly without installing anything globally:

```bash
npx talk-sql
```

This is the recommended approach for AI client configuration.

### Option 2 — Global install

```bash
npm install -g talk-sql
talk-sql
```

### Option 3 — From source

```bash
git clone https://github.com/Edavi11/talk-sql-mcp-server.git
cd talk-sql-mcp-server
npm install
npm run build
npm link        # Makes talk-sql available globally
```

> **Windows note:** If `better-sqlite3` fails during install (native C++ binding), you can safely ignore it if you are not using SQLite. The server works fully for PostgreSQL, MySQL, and SQL Server without it.

---

## 🚀 Running the Server

### stdio mode (default — used by Cursor, Claude Desktop, etc.)

```bash
npx talk-sql
```

### HTTP mode (for remote or multi-client use)

```bash
TRANSPORT=http PORT=3000 npx talk-sql
```

The server will be available at `http://localhost:3000/mcp`.

### Development (auto-reload, from source)

```bash
npm run dev
```

---

## 🔧 Configuration for AI Clients

The recommended approach for all clients is to use `npx` — no global install or path configuration needed.

### Cursor

Add the following to your `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "talk-sql": {
      "command": "npx",
      "args": ["talk-sql"],
      "env": {
        "SQL_CONNECTION_STRING": "mssql://user:password@localhost:1433/MyDatabase?encrypt=false&trustServerCertificate=true"
      }
    }
  }
}
```

### Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "talk-sql": {
      "command": "npx",
      "args": ["talk-sql"],
      "env": {
        "SQL_CONNECTION_STRING": "postgresql://user:password@localhost:5432/mydb"
      }
    }
  }
}
```

### Alternative — Global install (faster startup)

If you prefer to avoid the `npx` resolution overhead on every startup, install globally once:

```bash
npm install -g talk-sql
```

Then configure clients using the direct command:

```json
{
  "mcpServers": {
    "talk-sql": {
      "command": "talk-sql",
      "env": {
        "SQL_CONNECTION_STRING": "mssql://user:password@localhost:1433/MyDatabase?encrypt=false&trustServerCertificate=true"
      }
    }
  }
}
```

> **Tip:** Set `SQL_CONNECTION_STRING` in the `env` block as a default so you don't have to pass it on every tool call. You can always override it per-call by providing `connection_string` as a parameter.

---

## 🔌 Connection Strings

### 🐘 PostgreSQL

```
postgresql://user:password@localhost:5432/database
```

### 🐬 MySQL

```
mysql://user:password@localhost:3306/database
```

### 🪟 SQL Server

```
mssql://user:password@localhost:1433/database?encrypt=false&trustServerCertificate=true
```

| Option | Default | Description |
|---|---|---|
| `encrypt` | `false` | Enable TLS encryption |
| `trustServerCertificate` | `true` | Trust self-signed certs |

### 🪶 SQLite

```
sqlite:///absolute/path/to/database.db
```

---

## 🛠️ Available Tools

### `db_ping`
Tests connectivity and returns server version and latency. **Use this first** when diagnosing connection issues — it returns specific advice on how to fix the connection string.

```json
{
  "connection_string": "mssql://user:pass@localhost:1433/MyDB?encrypt=false&trustServerCertificate=true",
  "response_format": "json"
}
```

---

### `db_list_databases`
Returns all databases available on the server.

```json
{
  "connection_string": "postgresql://user:pass@localhost:5432/postgres",
  "response_format": "json"
}
```

---

### `db_list_tables`
Returns all schemas and their tables in a database.

```json
{
  "connection_string": "postgresql://user:pass@localhost:5432/mydb",
  "response_format": "markdown"
}
```

---

### `db_query`
Executes any SQL statement — SELECT, INSERT, UPDATE, DELETE, DDL, or SQL Server batch scripts (with `GO` separators).

```json
{
  "connection_string": "postgresql://user:pass@localhost:5432/mydb",
  "query": "SELECT id, name, email FROM users WHERE active = true LIMIT 20",
  "response_format": "markdown"
}
```

---

### `db_select`
Selects data from a table with built-in pagination, column filtering, and WHERE clause support. Handles `LIMIT/OFFSET` vs `OFFSET/FETCH` automatically per database.

```json
{
  "connection_string": "mysql://user:pass@localhost:3306/mydb",
  "table": "orders",
  "schema": "public",
  "columns": ["id", "customer_id", "total", "created_at"],
  "where": "status = 'pending'",
  "limit": 50,
  "offset": 0,
  "response_format": "json"
}
```

---

### `db_create_table`
Creates a new table with columns, types, constraints, and auto-increment — mapped automatically to the correct database syntax.

```json
{
  "connection_string": "mssql://user:pass@localhost:1433/MyDB",
  "table": "products",
  "columns": [
    { "name": "id", "type": "INT", "primary_key": true, "auto_increment": true },
    { "name": "name", "type": "VARCHAR(255)", "nullable": false },
    { "name": "price", "type": "DECIMAL(10,2)", "nullable": false },
    { "name": "created_at", "type": "DATETIME", "default": "GETDATE()" }
  ],
  "response_format": "json"
}
```

---

### `db_create_relation`
Adds foreign key constraints between tables.

```json
{
  "connection_string": "postgresql://user:pass@localhost:5432/mydb",
  "table": "orders",
  "foreign_keys": [
    {
      "column": "user_id",
      "references_table": "users",
      "references_column": "id",
      "on_delete": "CASCADE",
      "on_update": "NO ACTION"
    }
  ],
  "response_format": "json"
}
```

---

### `db_create_trigger`
Creates a database trigger with timing and event control. Syntax is automatically adapted to each database engine.

```json
{
  "connection_string": "postgresql://user:pass@localhost:5432/mydb",
  "table": "orders",
  "trigger_name": "trg_orders_audit",
  "timing": "AFTER",
  "event": "INSERT",
  "procedure": "INSERT INTO audit_log (table_name, action, created_at) VALUES ('orders', 'INSERT', NOW());",
  "response_format": "json"
}
```

---

## 🔄 Response Formats

All tools support two output formats via the `response_format` parameter:

| Format | Description |
|---|---|
| `"markdown"` | Human-readable table, ideal for chat interfaces |
| `"json"` | Structured output, ideal for programmatic use or chaining tool calls |

---

## 🧠 AI Assistant Behavior

This server is designed so that AI assistants **always have a path forward** when something fails:

- Every error response includes a **Next steps** section with specific recovery instructions
- `db_ping` gives targeted advice based on the error type (auth, network, SSL, missing DB, etc.)
- Tool descriptions explicitly tell the AI to **retry using the MCP tools** rather than falling back to Docker or shell commands

---

## 🏗️ Project Structure

```
src/
├── index.ts                    # MCP server entry point, tool registration
├── types.ts                    # Shared TypeScript types and enums
├── constants.ts                # Limits and shared constants
├── schemas/
│   └── connection.ts           # Zod validation schemas
├── services/
│   ├── connection-manager.ts   # Connection pooling for all DB types
│   └── query-executor.ts       # Query execution and result formatting
└── tools/
    ├── database-tools.ts       # db_ping, db_list_databases, db_list_tables
    ├── query-tools.ts          # db_query, db_select
    ├── ddl-tools.ts            # db_create_table, db_create_relation
    └── trigger-tools.ts        # db_create_trigger
```

---

## 📄 License

MIT
