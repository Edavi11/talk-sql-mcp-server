import { describe, it, expect } from "vitest";
import { formatResultsAsMarkdown, formatResultsAsJSON } from "../services/query-executor.js";

describe("formatResultsAsMarkdown", () => {
  it("returns 'No results found.' for empty rows", () => {
    expect(formatResultsAsMarkdown([])).toBe("No results found.");
  });

  it("returns 'No columns found.' when no columns can be extracted", () => {
    expect(formatResultsAsMarkdown(["not-an-object"])).toBe("No columns found.");
  });

  it("formats rows into a markdown table", () => {
    const rows = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
    const result = formatResultsAsMarkdown(rows);
    expect(result).toContain("| id | name |");
    expect(result).toContain("| --- | --- |");
    expect(result).toContain("| 1 | Alice |");
    expect(result).toContain("| 2 | Bob |");
  });

  it("uses provided columns instead of inferring from rows", () => {
    const rows = [{ id: 1, name: "Alice", secret: "hidden" }];
    const result = formatResultsAsMarkdown(rows, ["id", "name"]);
    expect(result).toContain("| id | name |");
    expect(result).not.toContain("secret");
  });

  it("renders NULL for null values", () => {
    const rows = [{ id: 1, name: null }];
    const result = formatResultsAsMarkdown(rows);
    expect(result).toContain("NULL");
  });

  it("renders NULL for undefined values", () => {
    const rows = [{ id: 1, name: undefined }];
    const result = formatResultsAsMarkdown(rows);
    expect(result).toContain("NULL");
  });

  it("serializes nested objects as JSON", () => {
    const rows = [{ id: 1, meta: { key: "value" } }];
    const result = formatResultsAsMarkdown(rows);
    expect(result).toContain('{"key":"value"}');
  });
});

describe("formatResultsAsJSON", () => {
  it("returns JSON with rowCount, columns, and rows", () => {
    const rows = [{ id: 1, name: "Alice" }];
    const result = formatResultsAsJSON(rows, 1, ["id", "name"]);
    const parsed = JSON.parse(result);
    expect(parsed.rowCount).toBe(1);
    expect(parsed.columns).toEqual(["id", "name"]);
    expect(parsed.rows).toEqual(rows);
  });

  it("infers columns from first row when not provided", () => {
    const rows = [{ id: 1, name: "Alice" }];
    const result = formatResultsAsJSON(rows, 1);
    const parsed = JSON.parse(result);
    expect(parsed.columns).toEqual(["id", "name"]);
  });

  it("returns empty columns for empty rows without provided columns", () => {
    const result = formatResultsAsJSON([], 0);
    const parsed = JSON.parse(result);
    expect(parsed.columns).toEqual([]);
    expect(parsed.rows).toEqual([]);
  });

  it("handles rowCount of 0", () => {
    const result = formatResultsAsJSON([], 0, []);
    const parsed = JSON.parse(result);
    expect(parsed.rowCount).toBe(0);
  });
});
