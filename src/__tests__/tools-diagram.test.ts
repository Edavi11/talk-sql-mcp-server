import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DatabaseType } from "../types.js";

vi.mock("../services/connection-manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/connection-manager.js")>();
  return { ...actual, createConnectionPool: vi.fn() };
});

vi.mock("../services/schema-introspection.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/schema-introspection.js")>();
  return { ...actual, introspectSchema: vi.fn() };
});

import { createConnectionPool } from "../services/connection-manager.js";
import { introspectSchema } from "../services/schema-introspection.js";
import { exportErDiagram } from "../tools/diagram-tools.js";
import type { SchemaGraph } from "../services/schema-introspection.js";

const mockClose = vi.fn();
function mockPool(type: DatabaseType) {
  return { type, pool: {}, close: mockClose };
}

const sampleGraph: SchemaGraph = {
  tables: [
    { schema: "public", name: "users", columns: [{ name: "id", type: "integer", nullable: false, primary_key: true }] }
  ],
  relations: []
};

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  mockClose.mockResolvedValue(undefined);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "talksql-diagram-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("exportErDiagram", () => {
  it("writes a mermaid file and returns counts", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(introspectSchema).mockResolvedValue(sampleGraph);

    const outPath = path.join(tmpDir, "schema");
    const result = await exportErDiagram({
      connection_string: "postgresql://user:pass@localhost/db",
      format: "mermaid",
      output_path: outPath,
      response_format: "json"
    });

    const written = path.join(tmpDir, "schema.md");
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readFileSync(written, "utf-8")).toContain("erDiagram");
    expect(result.structuredContent).toMatchObject({ success: true, tables: 1, relations: 0, format: "mermaid" });
    expect(mockClose).toHaveBeenCalled();
  });

  it("appends the correct extension per format", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(introspectSchema).mockResolvedValue(sampleGraph);

    const outPath = path.join(tmpDir, "graph");
    await exportErDiagram({
      connection_string: "postgresql://user:pass@localhost/db",
      format: "dbml",
      output_path: outPath,
      response_format: "json"
    });

    expect(fs.existsSync(path.join(tmpDir, "graph.dbml"))).toBe(true);
  });

  it("creates parent directories that do not exist", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(introspectSchema).mockResolvedValue(sampleGraph);

    const outPath = path.join(tmpDir, "nested", "deep", "schema.json");
    await exportErDiagram({
      connection_string: "postgresql://user:pass@localhost/db",
      format: "json",
      output_path: outPath,
      response_format: "json"
    });

    expect(fs.existsSync(outPath)).toBe(true);
  });

  it("returns an error and writes nothing when there are no tables", async () => {
    vi.mocked(createConnectionPool).mockResolvedValue(mockPool(DatabaseType.POSTGRESQL));
    vi.mocked(introspectSchema).mockResolvedValue({ tables: [], relations: [] });

    const outPath = path.join(tmpDir, "empty.md");
    const result = await exportErDiagram({
      connection_string: "postgresql://user:pass@localhost/db",
      format: "mermaid",
      output_path: outPath,
      response_format: "markdown"
    });

    expect(result.content[0].text).toContain("No tables found");
    expect(fs.existsSync(outPath)).toBe(false);
  });
});
