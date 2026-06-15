/**
 * Diagram Tools
 *
 * Exports the database schema as an Entity-Relationship diagram file that can be
 * visualized with VS Code / Cursor extensions (Mermaid, DBML, Graphviz) or
 * consumed programmatically (JSON).
 */

import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { ResponseFormat } from "../types.js";
import { createConnectionPool, detectDatabaseType } from "../services/connection-manager.js";
import { introspectSchema } from "../services/schema-introspection.js";
import { serializeDiagram, FORMAT_EXTENSIONS, DiagramFormat } from "../services/diagram-serializers.js";
import { ConnectionStringSchema, ConnectionNameSchema, ResponseFormatSchema, SchemaNameSchema } from "../schemas/connection.js";
import { resolveConnection } from "../constants.js";

/**
 * Schema for db_export_er_diagram tool
 */
export const ExportErDiagramInputSchema = z.object({
  connection_name: ConnectionNameSchema,
  connection_string: ConnectionStringSchema,
  schema: SchemaNameSchema,
  format: z.enum(["mermaid", "dbml", "json", "dot"])
    .default("mermaid")
    .describe("Diagram output format: 'mermaid' (renders in Markdown preview), 'dbml' (dbdiagram.io), 'json' (raw graph), or 'dot' (Graphviz). Ask the user which they prefer if unspecified."),
  output_path: z.string()
    .min(1, "output_path is required")
    .max(1000, "output_path is too long")
    .describe("Path where the diagram file is written. Defaults to the project root if a bare filename is given. The correct extension is appended automatically if missing."),
  response_format: ResponseFormatSchema
}).strict();

export type ExportErDiagramInput = z.infer<typeof ExportErDiagramInputSchema>;

/**
 * Resolves the final file path: ensures the extension matches the format and
 * makes the path absolute relative to the current working directory (project root).
 */
function resolveOutputPath(outputPath: string, format: DiagramFormat): string {
  const ext = FORMAT_EXTENSIONS[format];
  let target = outputPath;

  // Append the correct extension if the user didn't provide a matching one.
  if (path.extname(target).toLowerCase() !== ext) {
    // Mermaid also accepts .mmd; respect it if the user chose it explicitly.
    if (!(format === "mermaid" && path.extname(target).toLowerCase() === ".mmd")) {
      target = target + ext;
    }
  }

  return path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
}

/**
 * Exports the database schema as an ER diagram file.
 */
export async function exportErDiagram(params: ExportErDiagramInput): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: { [x: string]: unknown } }> {
  let resolved;
  try {
    resolved = await resolveConnection({
      connection_string: params.connection_string,
      connection_name: params.connection_name
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Connection error: ${msg}` }] };
  }

  try {
    const connectionPool = await createConnectionPool(resolved.connectionString);

    try {
      const dbType = detectDatabaseType(resolved.connectionString);
      const graph = await introspectSchema(connectionPool, resolved.connectionString, params.schema);

      if (graph.tables.length === 0) {
        const hint = params.schema
          ? `No tables found in schema '${params.schema}'. Use db_list_tables to verify the schema name.`
          : "No tables found. Use db_list_tables to confirm the database has tables.";
        return { content: [{ type: "text", text: `Error: ${hint}` }] };
      }

      const content = serializeDiagram(graph, params.format);
      const finalPath = resolveOutputPath(params.output_path, params.format);

      // Ensure parent directory exists before writing.
      const dir = path.dirname(finalPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(finalPath, content, "utf-8");

      const result = {
        success: true,
        format: params.format,
        output_path: finalPath,
        database_type: dbType,
        tables: graph.tables.length,
        relations: graph.relations.length
      };

      if (params.response_format === ResponseFormat.JSON) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result
        };
      }

      const lines = [
        `# ER Diagram Exported`,
        ``,
        `- **Format:** ${params.format}`,
        `- **File:** ${finalPath}`,
        `- **Tables:** ${graph.tables.length}`,
        `- **Relations:** ${graph.relations.length}`,
        ``,
        params.format === "mermaid"
          ? `Open the file and use VS Code/Cursor Markdown preview to view the diagram.`
          : params.format === "dbml"
            ? `Open with a DBML extension or paste into dbdiagram.io.`
            : params.format === "dot"
              ? `Open with a Graphviz preview extension.`
              : `JSON graph ready for programmatic use.`
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const lower = errorMsg.toLowerCase();
      const hints: string[] = [];
      if (lower.includes("econnrefused") || lower.includes("etimedout") || lower.includes("failed to connect") || lower.includes("connection")) {
        hints.push("Use db_ping to diagnose and fix the connection before retrying.");
      } else if (lower.includes("permission") || lower.includes("access denied")) {
        hints.push("The database user may not have permission to read the schema catalog.");
      } else if (lower.includes("eacces") || lower.includes("eperm") || lower.includes("enoent")) {
        hints.push("Could not write the file. Check that output_path is writable and the directory is accessible.");
      }
      const hintText = hints.length > 0 ? `\n\nNext steps:\n${hints.map(h => `- ${h}`).join("\n")}` : "";
      return { content: [{ type: "text", text: `Error exporting ER diagram: ${errorMsg}${hintText}` }] };
    } finally {
      await connectionPool.close();
    }
  } finally {
    await resolved.cleanup();
  }
}
