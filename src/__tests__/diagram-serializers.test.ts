import { describe, it, expect } from "vitest";
import { serializeDiagram, FORMAT_EXTENSIONS } from "../services/diagram-serializers.js";
import type { SchemaGraph } from "../services/schema-introspection.js";

const graph: SchemaGraph = {
  tables: [
    {
      schema: "public",
      name: "users",
      columns: [
        { name: "id", type: "integer", nullable: false, primary_key: true },
        { name: "email", type: "varchar", nullable: false, primary_key: false }
      ]
    },
    {
      schema: "public",
      name: "orders",
      columns: [
        { name: "id", type: "integer", nullable: false, primary_key: true },
        { name: "user_id", type: "integer", nullable: false, primary_key: false }
      ]
    }
  ],
  relations: [
    {
      from_schema: "public",
      from_table: "orders",
      from_column: "user_id",
      to_schema: "public",
      to_table: "users",
      to_column: "id"
    }
  ]
};

describe("serializeDiagram - mermaid", () => {
  it("produces an erDiagram block with tables, PK markers and relations", () => {
    const out = serializeDiagram(graph, "mermaid");
    expect(out).toContain("```mermaid");
    expect(out).toContain("erDiagram");
    expect(out).toContain("users {");
    expect(out).toContain("integer id PK");
    expect(out).toContain("orders }o--|| users");
  });

  it("sanitizes types with spaces/parens", () => {
    const g: SchemaGraph = {
      tables: [{ schema: "public", name: "t", columns: [{ name: "c", type: "character varying(255)", nullable: true, primary_key: false }] }],
      relations: []
    };
    const out = serializeDiagram(g, "mermaid");
    expect(out).not.toContain("character varying(255)");
    expect(out).toContain("character_varying_255_ c");
  });
});

describe("serializeDiagram - dbml", () => {
  it("produces Table blocks and Ref lines", () => {
    const out = serializeDiagram(graph, "dbml");
    expect(out).toContain("Table public.users {");
    expect(out).toContain("id integer [pk, not null]");
    expect(out).toContain("Ref: public.orders.user_id > public.users.id");
  });
});

describe("serializeDiagram - json", () => {
  it("round-trips the graph", () => {
    const out = serializeDiagram(graph, "json");
    expect(JSON.parse(out)).toEqual(graph);
  });
});

describe("serializeDiagram - dot", () => {
  it("produces a digraph with nodes and edges", () => {
    const out = serializeDiagram(graph, "dot");
    expect(out).toContain("digraph ER {");
    expect(out).toContain("orders -> users");
  });
});

describe("FORMAT_EXTENSIONS", () => {
  it("maps every format to an extension", () => {
    expect(FORMAT_EXTENSIONS.mermaid).toBe(".md");
    expect(FORMAT_EXTENSIONS.dbml).toBe(".dbml");
    expect(FORMAT_EXTENSIONS.json).toBe(".json");
    expect(FORMAT_EXTENSIONS.dot).toBe(".dot");
  });
});

describe("serializeDiagram - unsupported", () => {
  it("throws for unknown format", () => {
    // @ts-expect-error testing runtime guard
    expect(() => serializeDiagram(graph, "xml")).toThrow(/Unsupported diagram format/);
  });
});
