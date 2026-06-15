# 🗄️ talk-sql

**talk-sql** is a **Model Context Protocol (MCP)** server that gives AI assistants (Cursor, Claude, Copilot, etc.) full, native SQL database access — without resorting to Docker commands or shell workarounds.

Supports **PostgreSQL**, **MySQL**, **SQL Server**, and **SQLite** through a unified set of tools.

---

## ✨ Features

| Capability | Tool |
|---|---|
| 📋 List configured connections | `db_list_connections` |
| 🔌 Test & diagnose connection | `db_ping` |
| 🗂️ List all databases | `db_list_databases` |
| 📋 List schemas and tables | `db_list_tables` |
| ⚡ Execute any SQL query | `db_query` |
| 📄 Select data with pagination | `db_select` |
| 🏗️ Create tables | `db_create_table` |
| 🔗 Create foreign key relations | `db_create_relation` |
| ⚙️ Create triggers | `db_create_trigger` |
| 📊 Export ER diagram to a file | `db_export_er_diagram` |

**Supports:** PostgreSQL · MySQL · SQL Server · SQLite · IBM DB2

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

### Multiple connections (recommended)

The recommended approach is to define all your databases in a single JSON config file and point talk-sql to it. This way you only need **one MCP server entry** regardless of how many databases you use.

**Step 1 — Create a config file** (e.g. `~/talk-sql.config.json`):

```json
[
  {
    "name": "local",
    "connectionString": "postgresql://user:password@localhost:5432/mydb"
  },
  {
    "name": "production",
    "connectionString": "postgresql://user:password@prod-server:5432/mydb"
  }
]
```

**Step 2 — Configure your MCP client** to point to that file:

```json
{
  "mcpServers": {
    "talk-sql": {
      "command": "npx",
      "args": ["-y", "talk-sql"],
      "env": {
        "TALK_SQL_CONFIG": "/absolute/path/to/talk-sql.config.json"
      }
    }
  }
}
```

The AI can then use `db_list_connections` to discover available connections and use `connection_name` in any tool call:

```
db_ping(connection_name="local")
db_query(connection_name="production", query="SELECT * FROM users LIMIT 10")
```

---

### SSH tunnels

Connections in the config file can include an `ssh` block to route traffic through an SSH tunnel. Useful for databases that are not directly reachable from your machine.

**With a private key:**

```json
[
  {
    "name": "remote-db",
    "connectionString": "postgresql://postgres:pass@localhost:5432/mydb",
    "ssh": {
      "host": "185.207.250.95",
      "port": 22,
      "username": "root",
      "privateKeyPath": "~/.ssh/id_rsa"
    }
  }
]
```

**With a password:**

```json
[
  {
    "name": "remote-db",
    "connectionString": "postgresql://postgres:pass@localhost:5432/mydb",
    "ssh": {
      "host": "185.207.250.95",
      "port": 22,
      "username": "root",
      "password": "my-ssh-password"
    }
  }
]
```

> **Note:** The `connectionString` should use the hostname as seen **from the SSH server**. If the database runs on the same machine as the SSH server, use `localhost`. If it runs on a different machine in the same private network, use its internal IP.

---

### Single connection (legacy / simple setup)

If you only have one database, you can skip the config file and set `SQL_CONNECTION_STRING` directly:

#### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "talk-sql": {
      "command": "npx",
      "args": ["-y", "talk-sql"],
      "env": {
        "SQL_CONNECTION_STRING": "mssql://user:password@localhost:1433/MyDatabase?encrypt=false&trustServerCertificate=true"
      }
    }
  }
}
```

#### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "talk-sql": {
      "command": "npx",
      "args": ["-y", "talk-sql"],
      "env": {
        "SQL_CONNECTION_STRING": "postgresql://user:password@localhost:5432/mydb"
      }
    }
  }
}
```

---

### Global install (faster startup)

If you prefer to avoid the `npx` resolution overhead on every startup, install globally once:

```bash
npm install -g talk-sql
```

Then use `"command": "talk-sql"` instead of `"command": "npx"` in your client config.

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

### 🔵 IBM DB2

```
db2://user:password@localhost:50000/DATABASE
```

> **Note:** IBM DB2 support requires the `ibm_db` package (`npm install ibm_db`). It is an optional dependency — the server works without it for all other databases. During installation, `ibm_db` automatically downloads the IBM ODBC CLI driver (~100 MB).

---

## 🛠️ Available Tools

### `db_list_connections`

Lists all named connections configured in the config file. Use this first to discover available connection names.

```json
{
  "response_format": "json"
}
```

Example response:
```json
{
  "connections": [
    { "name": "local", "type": "postgresql", "has_ssh": false },
    { "name": "remote-db", "type": "postgresql", "has_ssh": true }
  ],
  "total": 2,
  "note": "Use connection_name parameter in other tools to specify which connection to use."
}
```

---

### `db_ping`

Tests connectivity and returns server version and latency. **Use this first** when diagnosing connection issues.

```json
{
  "connection_name": "local",
  "response_format": "json"
}
```

---

### `db_list_databases`

Returns all databases available on the server.

```json
{
  "connection_name": "local",
  "response_format": "json"
}
```

---

### `db_list_tables`

Returns all schemas and their tables in a database.

```json
{
  "connection_name": "local",
  "response_format": "markdown"
}
```

---

### `db_query`

Executes any SQL statement — SELECT, INSERT, UPDATE, DELETE, DDL, or SQL Server batch scripts (with `GO` separators).

```json
{
  "connection_name": "production",
  "query": "SELECT id, name, email FROM users WHERE active = true LIMIT 20",
  "response_format": "markdown"
}
```

---

### `db_select`

Selects data from a table with built-in pagination, column filtering, and WHERE clause support. Handles `LIMIT/OFFSET` vs `OFFSET/FETCH` automatically per database.

```json
{
  "connection_name": "local",
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
  "connection_name": "local",
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
  "connection_name": "local",
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
  "connection_name": "local",
  "table": "orders",
  "trigger_name": "trg_orders_audit",
  "timing": "AFTER",
  "event": "INSERT",
  "procedure": "INSERT INTO audit_log (table_name, action, created_at) VALUES ('orders', 'INSERT', NOW());",
  "response_format": "json"
}
```

---

### `db_export_er_diagram`

Introspects the full database schema (tables, columns, types, primary keys, and foreign keys) and writes an **Entity-Relationship diagram file** to disk that you can visualize directly in VS Code / Cursor.

Pick the `format` that matches the extension you want to view with:

| Format | File | How to view |
|---|---|---|
| `mermaid` | `.md` | Built-in Markdown preview (zero setup) — recommended |
| `dbml` | `.dbml` | DBML extension or paste into [dbdiagram.io](https://dbdiagram.io) |
| `json` | `.json` | Raw `{ tables, relations }` graph for programmatic use |
| `dot` | `.dot` | Graphviz preview extension |

```json
{
  "connection_name": "local",
  "schema": "public",
  "format": "mermaid",
  "output_path": "docs/schema",
  "response_format": "json"
}
```

- `output_path` defaults to the **project root** if you pass a bare filename. The correct extension is appended automatically if missing, and parent directories are created as needed.
- Omit `schema` to export the **entire database**.

Example response:
```json
{
  "success": true,
  "format": "mermaid",
  "output_path": "/abs/path/docs/schema.md",
  "database_type": "postgresql",
  "tables": 12,
  "relations": 18
}
```

---

## 🔄 Connection Resolution Priority

When a tool is called, talk-sql resolves the connection in this order:

| Priority | Source | How |
|---|---|---|
| 1 | `connection_name` param | Looks up name in config file |
| 2 | `connection_string` param | Uses the string directly |
| 3 | Single entry in config file | Auto-selects if only one exists |
| 4 | `SQL_CONNECTION_STRING` env var | Legacy fallback |

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
- `db_list_connections` lets the AI discover available connections before making any DB call

---

## 🏗️ Project Structure

```
src/
├── index.ts                    # MCP server entry point, tool registration
├── types.ts                    # Shared TypeScript types and enums
├── constants.ts                # Limits, connection resolution logic
├── schemas/
│   └── connection.ts           # Zod validation schemas
├── services/
│   ├── connection-manager.ts   # Connection pooling for all DB types
│   ├── query-executor.ts       # Query execution and result formatting
│   ├── ssh-tunnel.ts           # SSH tunnel support
│   ├── schema-introspection.ts # Engine-agnostic schema graph (tables, columns, FKs)
│   └── diagram-serializers.ts  # Mermaid / DBML / JSON / DOT serializers
└── tools/
    ├── database-tools.ts       # db_ping, db_list_databases, db_list_tables, db_list_connections
    ├── query-tools.ts          # db_query, db_select
    ├── ddl-tools.ts            # db_create_table, db_create_relation
    ├── trigger-tools.ts        # db_create_trigger
    └── diagram-tools.ts        # db_export_er_diagram
```

---

## 📄 License

MIT
