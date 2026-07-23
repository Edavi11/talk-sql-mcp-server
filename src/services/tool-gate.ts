/**
 * Shared gating layer for MCP tool handlers.
 * Enforces TALK_SQL_READONLY mode and confirm=true gating for destructive
 * db_query statements, before any connection/pool is touched.
 */

import { DatabaseType } from "../types.js";
import { isReadOnlyMode } from "../constants.js";
import { detectDatabaseType } from "./connection-manager.js";
import { classifyQuery } from "./query-classifier.js";

export type ToolCategory =
  | { kind: "always-read" }
  | { kind: "always-write" }
  | { kind: "dynamic-sql" };

export interface GateBlockedResult {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: { [x: string]: unknown };
}

interface DynamicSqlParams {
  query: string;
  confirm?: boolean;
  connection_string?: string;
}

function readOnlyBlockedMessage(toolName: string): GateBlockedResult {
  return {
    content: [{
      type: "text",
      text: `This server is running in read-only mode (TALK_SQL_READONLY=true). '${toolName}' modifies the database and is disabled.\n\nNext steps:\n- Ask the user to disable read-only mode if this operation is intentional.\n- Use db_select or db_query with a SELECT statement to read data instead.`
    }],
    structuredContent: { blocked: true, reason: "readonly_mode" }
  };
}

function confirmRequiredResult(query: string, classificationLabel: string): GateBlockedResult {
  return {
    content: [{
      type: "text",
      text: `Destructive operation detected - confirmation required.\n\nQuery:\n\`\`\`sql\n${query}\n\`\`\`\n\nClassification: ${classificationLabel}\n\nThis operation was NOT executed. To proceed, call db_query again with the same query and confirm: true.\n\nNext steps:\n- If this is intentional, retry with confirm: true.\n- If this is NOT intentional, add a WHERE clause to limit scope, or review the query.`
    }],
    structuredContent: { blocked: true, reason: "destructive_confirmation_required", classification: classificationLabel, query }
  };
}

function resolveDbTypeForClassification(connectionString: string | undefined): DatabaseType {
  if (connectionString) {
    try {
      return detectDatabaseType(connectionString);
    } catch {
      // fall through to generic dialect
    }
  }
  return DatabaseType.POSTGRESQL;
}

export function withGate<TParams, TResult>(
  toolName: string,
  category: ToolCategory,
  handler: (params: TParams) => Promise<TResult>
): (params: TParams) => Promise<TResult | GateBlockedResult> {
  return async (params: TParams): Promise<TResult | GateBlockedResult> => {
    if (category.kind === "always-read") {
      return handler(params);
    }

    if (category.kind === "always-write") {
      if (isReadOnlyMode()) {
        return readOnlyBlockedMessage(toolName);
      }
      return handler(params);
    }

    // dynamic-sql (db_query)
    const dynParams = params as unknown as DynamicSqlParams;
    const dbType = resolveDbTypeForClassification(dynParams.connection_string);
    const classification = classifyQuery(dynParams.query, dbType);

    if (isReadOnlyMode() && classification.type !== "SELECT" && classification.type !== "EXPLAIN") {
      return readOnlyBlockedMessage(toolName);
    }

    const needsConfirm = classification.isDestructive
      && !(classification.type === "DML" && classification.hasWhere);

    if (needsConfirm && !dynParams.confirm) {
      const label = classification.type === "DDL" ? "DDL (DROP/TRUNCATE)" : "DML without WHERE clause";
      return confirmRequiredResult(dynParams.query, label);
    }

    return handler(params);
  };
}
