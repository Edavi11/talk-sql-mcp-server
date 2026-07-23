/**
 * Schema Introspection
 *
 * Builds an engine-agnostic representation of a database schema
 * (tables, columns, primary keys, foreign keys) that diagram serializers consume.
 *
 * The output is intentionally a small intermediate structure so that adding a new
 * output format only requires a new serializer, not new introspection logic.
 */

import { DatabaseType } from "../types.js";
import { ConnectionPool, detectDatabaseType } from "./connection-manager.js";
import { executeQuery } from "./query-executor.js";

export interface IntrospectedColumn {
  name: string;
  type: string;
  nullable: boolean;
  primary_key: boolean;
}

export interface IntrospectedTable {
  schema: string;
  name: string;
  columns: IntrospectedColumn[];
}

export interface IntrospectedRelation {
  from_schema: string;
  from_table: string;
  from_column: string;
  to_schema: string;
  to_table: string;
  to_column: string;
}

export interface SchemaGraph {
  tables: IntrospectedTable[];
  relations: IntrospectedRelation[];
}

/** Escapes a single-quoted SQL literal. */
function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Returns the query that lists columns (with type, nullability, PK flag) for all
 * user tables, optionally restricted to a single schema.
 */
function getColumnsQuery(dbType: DatabaseType, schema?: string): string {
  switch (dbType) {
    case DatabaseType.POSTGRESQL:
    case DatabaseType.COCKROACHDB: {
      const filter = schema ? `AND c.table_schema = '${sqlLiteral(schema)}'` : "";
      return `
        SELECT
          c.table_schema AS schema_name,
          c.table_name,
          c.column_name,
          c.data_type,
          c.is_nullable,
          CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT kcu.table_schema, kcu.table_name, kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
        ) pk
          ON pk.table_schema = c.table_schema
         AND pk.table_name = c.table_name
         AND pk.column_name = c.column_name
        WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
        ${filter}
        ORDER BY c.table_schema, c.table_name, c.ordinal_position
      `;
    }
    case DatabaseType.MYSQL: {
      const filter = schema
        ? `AND c.table_schema = '${sqlLiteral(schema)}'`
        : `AND c.table_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')`;
      return `
        SELECT
          c.table_schema AS schema_name,
          c.table_name,
          c.column_name,
          c.data_type,
          c.is_nullable,
          CASE WHEN c.column_key = 'PRI' THEN 1 ELSE 0 END AS is_primary_key
        FROM information_schema.columns c
        WHERE 1=1
        ${filter}
        ORDER BY c.table_schema, c.table_name, c.ordinal_position
      `;
    }
    case DatabaseType.SQLSERVER: {
      const filter = schema ? `AND s.name = '${sqlLiteral(schema)}'` : "";
      return `
        SELECT
          s.name AS schema_name,
          t.name AS table_name,
          col.name AS column_name,
          ty.name AS data_type,
          CASE WHEN col.is_nullable = 1 THEN 'YES' ELSE 'NO' END AS is_nullable,
          CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key
        FROM sys.tables t
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        JOIN sys.columns col ON col.object_id = t.object_id
        JOIN sys.types ty ON ty.user_type_id = col.user_type_id
        LEFT JOIN (
          SELECT ic.object_id, ic.column_id
          FROM sys.indexes i
          JOIN sys.index_columns ic
            ON i.object_id = ic.object_id AND i.index_id = ic.index_id
          WHERE i.is_primary_key = 1
        ) pk ON pk.object_id = col.object_id AND pk.column_id = col.column_id
        WHERE 1=1
        ${filter}
        ORDER BY s.name, t.name, col.column_id
      `;
    }
    case DatabaseType.SQLITE:
      // SQLite needs PRAGMA per table; handled separately in introspectSqlite.
      return "";
    case DatabaseType.DB2: {
      const filter = schema
        ? `AND c.TABSCHEMA = '${sqlLiteral(schema)}'`
        : `AND c.TABSCHEMA NOT LIKE 'SYS%'`;
      return `
        SELECT
          c.TABSCHEMA AS schema_name,
          c.TABNAME AS table_name,
          c.COLNAME AS column_name,
          c.TYPENAME AS data_type,
          CASE WHEN c.NULLS = 'Y' THEN 'YES' ELSE 'NO' END AS is_nullable,
          CASE WHEN c.KEYSEQ IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key
        FROM SYSCAT.COLUMNS c
        JOIN SYSCAT.TABLES t
          ON t.TABSCHEMA = c.TABSCHEMA AND t.TABNAME = c.TABNAME AND t.TYPE = 'T'
        WHERE 1=1
        ${filter}
        ORDER BY c.TABSCHEMA, c.TABNAME, c.COLNO
      `;
    }
    default:
      throw new Error(`Unsupported database type: ${dbType}`);
  }
}

/**
 * Returns the query that lists foreign key relations, optionally restricted to a schema.
 */
function getForeignKeysQuery(dbType: DatabaseType, schema?: string): string {
  switch (dbType) {
    case DatabaseType.POSTGRESQL:
    case DatabaseType.COCKROACHDB: {
      const filter = schema ? `AND tc.table_schema = '${sqlLiteral(schema)}'` : "";
      return `
        SELECT
          tc.table_schema AS from_schema,
          tc.table_name AS from_table,
          kcu.column_name AS from_column,
          ccu.table_schema AS to_schema,
          ccu.table_name AS to_table,
          ccu.column_name AS to_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        ${filter}
        ORDER BY from_schema, from_table, from_column
      `;
    }
    case DatabaseType.MYSQL: {
      const filter = schema
        ? `AND kcu.table_schema = '${sqlLiteral(schema)}'`
        : `AND kcu.table_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')`;
      return `
        SELECT
          kcu.table_schema AS from_schema,
          kcu.table_name AS from_table,
          kcu.column_name AS from_column,
          kcu.referenced_table_schema AS to_schema,
          kcu.referenced_table_name AS to_table,
          kcu.referenced_column_name AS to_column
        FROM information_schema.key_column_usage kcu
        WHERE kcu.referenced_table_name IS NOT NULL
        ${filter}
        ORDER BY from_schema, from_table, from_column
      `;
    }
    case DatabaseType.SQLSERVER: {
      const filter = schema ? `AND fs.name = '${sqlLiteral(schema)}'` : "";
      return `
        SELECT
          fs.name AS from_schema,
          ft.name AS from_table,
          fc.name AS from_column,
          ts.name AS to_schema,
          tt.name AS to_table,
          tc.name AS to_column
        FROM sys.foreign_key_columns fkc
        JOIN sys.tables ft ON ft.object_id = fkc.parent_object_id
        JOIN sys.schemas fs ON fs.schema_id = ft.schema_id
        JOIN sys.columns fc ON fc.object_id = fkc.parent_object_id AND fc.column_id = fkc.parent_column_id
        JOIN sys.tables tt ON tt.object_id = fkc.referenced_object_id
        JOIN sys.schemas ts ON ts.schema_id = tt.schema_id
        JOIN sys.columns tc ON tc.object_id = fkc.referenced_object_id AND tc.column_id = fkc.referenced_column_id
        WHERE 1=1
        ${filter}
        ORDER BY from_schema, from_table, from_column
      `;
    }
    case DatabaseType.SQLITE:
      // SQLite needs PRAGMA per table; handled separately in introspectSqlite.
      return "";
    case DatabaseType.DB2: {
      const filter = schema
        ? `AND r.TABSCHEMA = '${sqlLiteral(schema)}'`
        : `AND r.TABSCHEMA NOT LIKE 'SYS%'`;
      return `
        SELECT
          r.TABSCHEMA AS from_schema,
          r.TABNAME AS from_table,
          kf.COLNAME AS from_column,
          r.REFTABSCHEMA AS to_schema,
          r.REFTABNAME AS to_table,
          kp.COLNAME AS to_column
        FROM SYSCAT.REFERENCES r
        JOIN SYSCAT.KEYCOLUSE kf
          ON kf.CONSTNAME = r.CONSTNAME AND kf.TABSCHEMA = r.TABSCHEMA AND kf.TABNAME = r.TABNAME
        JOIN SYSCAT.KEYCOLUSE kp
          ON kp.CONSTNAME = r.REFKEYNAME AND kp.COLSEQ = kf.COLSEQ
        WHERE 1=1
        ${filter}
        ORDER BY from_schema, from_table, from_column
      `;
    }
    default:
      throw new Error(`Unsupported database type: ${dbType}`);
  }
}

function asString(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

/** Builds the schema graph for non-SQLite engines from columns + FK rows. */
function buildGraphFromRows(columnRows: unknown[], fkRows: unknown[]): SchemaGraph {
  const tablesMap = new Map<string, IntrospectedTable>();

  for (const row of columnRows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const schema = asString(r.schema_name, "main");
    const tableName = asString(r.table_name);
    if (!tableName) continue;

    const key = `${schema}.${tableName}`;
    if (!tablesMap.has(key)) {
      tablesMap.set(key, { schema, name: tableName, columns: [] });
    }
    tablesMap.get(key)!.columns.push({
      name: asString(r.column_name),
      type: asString(r.data_type),
      nullable: asString(r.is_nullable).toUpperCase() === "YES",
      primary_key: asString(r.is_primary_key) === "1" || r.is_primary_key === 1 || r.is_primary_key === true
    });
  }

  const relations: IntrospectedRelation[] = [];
  for (const row of fkRows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    relations.push({
      from_schema: asString(r.from_schema, "main"),
      from_table: asString(r.from_table),
      from_column: asString(r.from_column),
      to_schema: asString(r.to_schema, "main"),
      to_table: asString(r.to_table),
      to_column: asString(r.to_column)
    });
  }

  return { tables: Array.from(tablesMap.values()), relations };
}

/** SQLite introspection requires PRAGMA calls per table. */
async function introspectSqlite(connectionPool: ConnectionPool): Promise<SchemaGraph> {
  const tablesResult = await executeQuery({
    connectionPool,
    query: "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  });

  const tables: IntrospectedTable[] = [];
  const relations: IntrospectedRelation[] = [];

  for (const row of tablesResult.rows) {
    if (!row || typeof row !== "object") continue;
    const tableName = asString((row as Record<string, unknown>).name);
    if (!tableName) continue;

    const columnsResult = await executeQuery({
      connectionPool,
      query: `PRAGMA table_info("${tableName.replace(/"/g, '""')}")`
    });
    const columns: IntrospectedColumn[] = columnsResult.rows
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => ({
        name: asString(c.name),
        type: asString(c.type) || "TEXT",
        nullable: asString(c.notnull) !== "1",
        primary_key: asString(c.pk) !== "0" && asString(c.pk) !== ""
      }));

    tables.push({ schema: "main", name: tableName, columns });

    const fkResult = await executeQuery({
      connectionPool,
      query: `PRAGMA foreign_key_list("${tableName.replace(/"/g, '""')}")`
    });
    for (const fk of fkResult.rows) {
      if (!fk || typeof fk !== "object") continue;
      const f = fk as Record<string, unknown>;
      relations.push({
        from_schema: "main",
        from_table: tableName,
        from_column: asString(f.from),
        to_schema: "main",
        to_table: asString(f.table),
        to_column: asString(f.to)
      });
    }
  }

  return { tables, relations };
}

/**
 * Introspects the full schema (or a single schema if provided) and returns an
 * engine-agnostic graph of tables and foreign key relations.
 */
export async function introspectSchema(
  connectionPool: ConnectionPool,
  connectionString: string,
  schema?: string
): Promise<SchemaGraph> {
  const dbType = detectDatabaseType(connectionString);

  if (dbType === DatabaseType.SQLITE) {
    return introspectSqlite(connectionPool);
  }

  const columnsResult = await executeQuery({
    connectionPool,
    query: getColumnsQuery(dbType, schema)
  });
  const fkResult = await executeQuery({
    connectionPool,
    query: getForeignKeysQuery(dbType, schema)
  });

  return buildGraphFromRows(columnsResult.rows, fkResult.rows);
}
