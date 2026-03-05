/**
 * DDL Tools
 * Tools for creating tables and relationships
 */

import { z } from "zod";
import { DatabaseType, ResponseFormat, ColumnDefinition, ForeignKeyDefinition } from "../types.js";
import { createConnectionPool, detectDatabaseType, sanitizeIdentifier } from "../services/connection-manager.js";
import { executeQuery, formatResultsAsMarkdown, formatResultsAsJSON } from "../services/query-executor.js";
import { ConnectionStringSchema, ResponseFormatSchema, TableNameSchema, SchemaNameSchema } from "../schemas/connection.js";
import { getConnectionString } from "../constants.js";

/**
 * Schema for column definition
 */
export const ColumnDefinitionSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_]+$/),
  type: z.string().min(1).max(100),
  nullable: z.boolean().optional(),
  primary_key: z.boolean().optional(),
  unique: z.boolean().optional(),
  default: z.string().optional(),
  auto_increment: z.boolean().optional()
}).strict();

/**
 * Schema for db_create_table tool
 */
export const CreateTableInputSchema = z.object({
  connection_string: ConnectionStringSchema,
  schema: SchemaNameSchema,
  table: TableNameSchema,
  columns: z.array(ColumnDefinitionSchema).min(1),
  response_format: ResponseFormatSchema
}).strict();

export type CreateTableInput = z.infer<typeof CreateTableInputSchema>;

/**
 * Schema for foreign key definition
 */
export const ForeignKeyDefinitionSchema = z.object({
  column: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_]+$/),
  references_table: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_]+$/),
  references_column: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_]+$/),
  on_delete: z.enum(["CASCADE", "SET NULL", "RESTRICT", "NO ACTION"]).optional(),
  on_update: z.enum(["CASCADE", "SET NULL", "RESTRICT", "NO ACTION"]).optional()
}).strict();

/**
 * Schema for db_create_relation tool
 */
export const CreateRelationInputSchema = z.object({
  connection_string: ConnectionStringSchema,
  schema: SchemaNameSchema,
  table: TableNameSchema,
  foreign_keys: z.array(ForeignKeyDefinitionSchema).min(1),
  response_format: ResponseFormatSchema
}).strict();

export type CreateRelationInput = z.infer<typeof CreateRelationInputSchema>;

/**
 * Maps generic SQL types to database-specific types
 */
function mapColumnType(dbType: DatabaseType, type: string, autoIncrement?: boolean): string {
  const upperType = type.toUpperCase();
  
  // Handle auto-increment types
  if (autoIncrement) {
    switch (dbType) {
      case DatabaseType.POSTGRESQL:
        if (upperType.includes("INT")) return "SERIAL";
        break;
      case DatabaseType.MYSQL:
        if (upperType.includes("INT")) return "INT AUTO_INCREMENT";
        break;
      case DatabaseType.SQLSERVER:
        if (upperType.includes("INT")) return "INT IDENTITY(1,1)";
        break;
      case DatabaseType.SQLITE:
        if (upperType.includes("INT")) return "INTEGER";
        break;
    }
  }
  
  // Return type as-is (database will validate)
  return type;
}

/**
 * Builds CREATE TABLE query
 */
function buildCreateTableQuery(
  dbType: DatabaseType,
  schema: string | undefined,
  table: string,
  columns: ColumnDefinition[]
): string {
  const safeTable = sanitizeIdentifier(table);
  const safeSchema = schema ? sanitizeIdentifier(schema) : undefined;
  const tableName = safeSchema ? `${safeSchema}.${safeTable}` : safeTable;
  
  const columnDefs: string[] = [];
  const primaryKeys: string[] = [];
  
  for (const col of columns) {
    const safeColName = sanitizeIdentifier(col.name);
    const colType = mapColumnType(dbType, col.type, col.auto_increment);
    
    let colDef = `${safeColName} ${colType}`;
    
    if (col.primary_key) {
      primaryKeys.push(safeColName);
    }
    
    if (!col.nullable && !col.primary_key) {
      colDef += " NOT NULL";
    }
    
    if (col.unique && !col.primary_key) {
      colDef += " UNIQUE";
    }
    
    if (col.default !== undefined) {
      colDef += ` DEFAULT ${col.default}`;
    }
    
    columnDefs.push(colDef);
  }
  
  // Add primary key constraint if specified
  if (primaryKeys.length > 0) {
    columnDefs.push(`PRIMARY KEY (${primaryKeys.join(", ")})`);
  }
  
  return `CREATE TABLE ${tableName} (\n  ${columnDefs.join(",\n  ")}\n)`;
}

/**
 * Creates a table
 */
export async function createTable(params: CreateTableInput): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: { [x: string]: unknown } }> {
  const connectionString = getConnectionString(params.connection_string);
  const connectionPool = await createConnectionPool(connectionString);
  
  try {
    const dbType = detectDatabaseType(connectionString);
    const query = buildCreateTableQuery(dbType, params.schema, params.table, params.columns);
    
    const result = await executeQuery({
      connectionPool,
      query
    });
    
    const tableName = params.schema ? `${params.schema}.${params.table}` : params.table;
    const message = `Table '${tableName}' created successfully.`;
    
    if (params.response_format === ResponseFormat.JSON) {
      const jsonOutput = {
        success: true,
        message,
        table: tableName,
        columns: params.columns.length,
        query
      };
      return {
        content: [{ type: "text", text: JSON.stringify(jsonOutput, null, 2) }],
        structuredContent: jsonOutput
      };
    }
    
    return {
      content: [{ type: "text", text: `${message}\n\nQuery executed:\n\`\`\`sql\n${query}\n\`\`\`` }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error creating table: ${error instanceof Error ? error.message : String(error)}`
      }]
    };
  } finally {
    await connectionPool.close();
  }
}

/**
 * Builds ALTER TABLE ADD FOREIGN KEY queries
 */
function buildForeignKeyQueries(
  dbType: DatabaseType,
  schema: string | undefined,
  table: string,
  foreignKeys: ForeignKeyDefinition[]
): string[] {
  const safeTable = sanitizeIdentifier(table);
  const safeSchema = schema ? sanitizeIdentifier(schema) : undefined;
  const tableName = safeSchema ? `${safeSchema}.${safeTable}` : safeTable;
  
  const queries: string[] = [];
  
  for (const fk of foreignKeys) {
    const safeCol = sanitizeIdentifier(fk.column);
    const safeRefTable = sanitizeIdentifier(fk.references_table);
    const safeRefCol = sanitizeIdentifier(fk.references_column);
    const refTableName = safeSchema ? `${safeSchema}.${safeRefTable}` : safeRefTable;
    
    const onDelete = fk.on_delete || "NO ACTION";
    const onUpdate = fk.on_update || "NO ACTION";
    
    // Generate constraint name
    const constraintName = `fk_${safeTable}_${safeCol}`;
    
    let query = `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} `;
    query += `FOREIGN KEY (${safeCol}) REFERENCES ${refTableName}(${safeRefCol})`;
    
    // Add ON DELETE and ON UPDATE clauses
    if (dbType === DatabaseType.SQLSERVER) {
      // SQL Server uses different syntax
      query += ` ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
    } else {
      query += ` ON DELETE ${onDelete} ON UPDATE ${onUpdate}`;
    }
    
    queries.push(query);
  }
  
  return queries;
}

/**
 * Creates foreign key relationships
 */
export async function createRelation(params: CreateRelationInput): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: { [x: string]: unknown } }> {
  const connectionString = getConnectionString(params.connection_string);
  const connectionPool = await createConnectionPool(connectionString);
  
  try {
    const dbType = detectDatabaseType(connectionString);
    const queries = buildForeignKeyQueries(dbType, params.schema, params.table, params.foreign_keys);
    
    const executedQueries: string[] = [];
    let successCount = 0;
    
    for (const query of queries) {
      try {
        await executeQuery({
          connectionPool,
          query
        });
        executedQueries.push(query);
        successCount++;
      } catch (error) {
        // Continue with other foreign keys even if one fails
        executedQueries.push(`-- Failed: ${error instanceof Error ? error.message : String(error)}\n${query}`);
      }
    }
    
    const tableName = params.schema ? `${params.schema}.${params.table}` : params.table;
    const message = `Created ${successCount} of ${params.foreign_keys.length} foreign key(s) on table '${tableName}'.`;
    
    if (params.response_format === ResponseFormat.JSON) {
      const jsonOutput = {
        success: successCount === params.foreign_keys.length,
        message,
        table: tableName,
        foreign_keys_created: successCount,
        total_foreign_keys: params.foreign_keys.length,
        queries: executedQueries
      };
      return {
        content: [{ type: "text", text: JSON.stringify(jsonOutput, null, 2) }],
        structuredContent: jsonOutput
      };
    }
    
    const queriesText = executedQueries.map((q, i) => `${i + 1}. ${q}`).join("\n\n");
    return {
      content: [{ type: "text", text: `${message}\n\nQueries executed:\n\`\`\`sql\n${queriesText}\n\`\`\`` }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error creating relations: ${error instanceof Error ? error.message : String(error)}`
      }]
    };
  } finally {
    await connectionPool.close();
  }
}
