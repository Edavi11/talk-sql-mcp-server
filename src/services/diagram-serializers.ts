/**
 * Diagram Serializers
 *
 * Converts an engine-agnostic SchemaGraph into a textual diagram in various
 * formats. Each serializer is a pure function of the graph, so adding a new
 * output format means adding one function here — no introspection changes needed.
 */

import type { SchemaGraph, IntrospectedTable } from "./schema-introspection.js";

export type DiagramFormat = "mermaid" | "dbml" | "json" | "dot";

/** Default file extension for each supported format. */
export const FORMAT_EXTENSIONS: Record<DiagramFormat, string> = {
  mermaid: ".md",
  dbml: ".dbml",
  json: ".json",
  dot: ".dot"
};

/**
 * Mermaid identifiers can't contain dots or spaces. We qualify with schema only
 * when it isn't the conventional default to keep diagrams readable.
 */
function nodeId(table: IntrospectedTable): string {
  const base =
    table.schema && table.schema !== "main" && table.schema !== "public" && table.schema !== "dbo"
      ? `${table.schema}_${table.name}`
      : table.name;
  return base.replace(/[^A-Za-z0-9_]/g, "_");
}

/** Looks up the qualified node id for a (schema, table) pair referenced by an FK. */
function refNodeId(graph: SchemaGraph, schema: string, table: string): string {
  const match = graph.tables.find((t) => t.name === table && (t.schema === schema || !schema));
  if (match) return nodeId(match);
  // FK points at a table outside the introspected set; synthesize a stable id.
  return nodeId({ schema, name: table, columns: [] });
}

/** Sanitizes a SQL type for Mermaid (no spaces/parens/commas allowed in attr types). */
function mermaidType(type: string): string {
  return type.replace(/[^A-Za-z0-9_]/g, "_") || "unknown";
}

function serializeMermaid(graph: SchemaGraph): string {
  const lines: string[] = ["```mermaid", "erDiagram"];

  // Relations first so the diagram reads top-down from connections.
  for (const rel of graph.relations) {
    const from = refNodeId(graph, rel.from_schema, rel.from_table);
    const to = refNodeId(graph, rel.to_schema, rel.to_table);
    // child }o--|| parent : "fk_column"
    lines.push(`    ${from} }o--|| ${to} : "${rel.from_column}"`);
  }

  for (const table of graph.tables) {
    lines.push(`    ${nodeId(table)} {`);
    for (const col of table.columns) {
      const key = col.primary_key ? " PK" : "";
      lines.push(`        ${mermaidType(col.type)} ${col.name}${key}`);
    }
    lines.push("    }");
  }

  lines.push("```", "");
  return lines.join("\n");
}

/** DBML quotes identifiers that aren't simple words. */
function dbmlIdent(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name}"`;
}

function dbmlTableName(table: IntrospectedTable): string {
  if (table.schema && table.schema !== "main") {
    return `${dbmlIdent(table.schema)}.${dbmlIdent(table.name)}`;
  }
  return dbmlIdent(table.name);
}

function serializeDbml(graph: SchemaGraph): string {
  const lines: string[] = [];

  for (const table of graph.tables) {
    lines.push(`Table ${dbmlTableName(table)} {`);
    for (const col of table.columns) {
      const settings: string[] = [];
      if (col.primary_key) settings.push("pk");
      if (!col.nullable) settings.push("not null");
      const suffix = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
      lines.push(`  ${dbmlIdent(col.name)} ${dbmlIdent(col.type)}${suffix}`);
    }
    lines.push("}", "");
  }

  for (const rel of graph.relations) {
    const fromTable =
      rel.from_schema && rel.from_schema !== "main"
        ? `${dbmlIdent(rel.from_schema)}.${dbmlIdent(rel.from_table)}`
        : dbmlIdent(rel.from_table);
    const toTable =
      rel.to_schema && rel.to_schema !== "main"
        ? `${dbmlIdent(rel.to_schema)}.${dbmlIdent(rel.to_table)}`
        : dbmlIdent(rel.to_table);
    lines.push(
      `Ref: ${fromTable}.${dbmlIdent(rel.from_column)} > ${toTable}.${dbmlIdent(rel.to_column)}`
    );
  }

  lines.push("");
  return lines.join("\n");
}

function serializeJson(graph: SchemaGraph): string {
  return JSON.stringify(graph, null, 2) + "\n";
}

/** Escapes a string for use inside a Graphviz double-quoted label. */
function dotEscape(value: string): string {
  return value.replace(/"/g, '\\"');
}

function serializeDot(graph: SchemaGraph): string {
  const lines: string[] = [
    "digraph ER {",
    "  rankdir=LR;",
    "  node [shape=record, fontname=\"Helvetica\"];",
    ""
  ];

  for (const table of graph.tables) {
    const id = nodeId(table);
    const rows = table.columns
      .map((c) => {
        const pk = c.primary_key ? "🔑 " : "";
        return `${pk}${dotEscape(c.name)} : ${dotEscape(c.type)}`;
      })
      .join("\\l");
    lines.push(`  ${id} [label="{${dotEscape(table.name)}|${rows}\\l}"];`);
  }

  lines.push("");
  for (const rel of graph.relations) {
    const from = refNodeId(graph, rel.from_schema, rel.from_table);
    const to = refNodeId(graph, rel.to_schema, rel.to_table);
    lines.push(`  ${from} -> ${to} [label="${dotEscape(rel.from_column)}"];`);
  }

  lines.push("}", "");
  return lines.join("\n");
}

/**
 * Serializes a schema graph into the requested diagram format.
 */
export function serializeDiagram(graph: SchemaGraph, format: DiagramFormat): string {
  switch (format) {
    case "mermaid":
      return serializeMermaid(graph);
    case "dbml":
      return serializeDbml(graph);
    case "json":
      return serializeJson(graph);
    case "dot":
      return serializeDot(graph);
    default:
      throw new Error(`Unsupported diagram format: ${format}`);
  }
}
