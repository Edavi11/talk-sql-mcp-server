import { describe, it, expect } from "vitest";
import {
  ConnectionStringSchema,
  ResponseFormatSchema,
  DatabaseNameSchema,
  SchemaNameSchema,
  TableNameSchema,
  ColumnNameSchema,
  QuerySchema,
  LimitSchema,
  OffsetSchema,
  WhereClauseSchema,
  ColumnsSchema,
} from "../schemas/connection.js";

describe("ConnectionStringSchema", () => {
  it("accepts valid connection strings", () => {
    expect(ConnectionStringSchema.parse("postgresql://user:pass@localhost:5432/db")).toBe("postgresql://user:pass@localhost:5432/db");
    expect(ConnectionStringSchema.parse("mssql://user:pass@host:1433/db")).toBe("mssql://user:pass@host:1433/db");
  });

  it("accepts undefined (optional)", () => {
    expect(ConnectionStringSchema.parse(undefined)).toBeUndefined();
  });

  it("rejects strings longer than 500 chars", () => {
    expect(() => ConnectionStringSchema.parse("a".repeat(501))).toThrow();
  });
});

describe("ResponseFormatSchema", () => {
  it("accepts markdown", () => expect(ResponseFormatSchema.parse("markdown")).toBe("markdown"));
  it("accepts json", () => expect(ResponseFormatSchema.parse("json")).toBe("json"));
  it("defaults to markdown", () => expect(ResponseFormatSchema.parse(undefined)).toBe("markdown"));
  it("rejects invalid values", () => expect(() => ResponseFormatSchema.parse("html")).toThrow());
});

describe("DatabaseNameSchema", () => {
  it("accepts valid names", () => expect(DatabaseNameSchema.parse("my_db")).toBe("my_db"));
  it("accepts undefined (optional)", () => expect(DatabaseNameSchema.parse(undefined)).toBeUndefined());
  it("rejects special characters", () => expect(() => DatabaseNameSchema.parse("my-db!")).toThrow());
  it("rejects empty string", () => expect(() => DatabaseNameSchema.parse("")).toThrow());
});

describe("SchemaNameSchema", () => {
  it("accepts valid schema names", () => expect(SchemaNameSchema.parse("dbo")).toBe("dbo"));
  it("accepts undefined (optional)", () => expect(SchemaNameSchema.parse(undefined)).toBeUndefined());
  it("rejects names with spaces", () => expect(() => SchemaNameSchema.parse("my schema")).toThrow());
});

describe("TableNameSchema", () => {
  it("accepts valid table names", () => expect(TableNameSchema.parse("users")).toBe("users"));
  it("accepts names with numbers and underscores", () => expect(TableNameSchema.parse("table_1")).toBe("table_1"));
  it("rejects empty string", () => expect(() => TableNameSchema.parse("")).toThrow());
  it("rejects names with special characters", () => expect(() => TableNameSchema.parse("my-table")).toThrow());
  it("rejects names longer than 100 chars", () => expect(() => TableNameSchema.parse("a".repeat(101))).toThrow());
});

describe("ColumnNameSchema", () => {
  it("accepts valid column names", () => expect(ColumnNameSchema.parse("user_id")).toBe("user_id"));
  it("rejects names with hyphens", () => expect(() => ColumnNameSchema.parse("user-id")).toThrow());
});

describe("QuerySchema", () => {
  it("accepts valid SQL", () => expect(QuerySchema.parse("SELECT * FROM users")).toBe("SELECT * FROM users"));
  it("rejects empty query", () => expect(() => QuerySchema.parse("")).toThrow());
  it("rejects queries over 100000 chars", () => expect(() => QuerySchema.parse("a".repeat(100001))).toThrow());
});

describe("LimitSchema", () => {
  it("accepts valid limit", () => expect(LimitSchema.parse(50)).toBe(50));
  it("defaults to 100", () => expect(LimitSchema.parse(undefined)).toBe(100));
  it("rejects 0", () => expect(() => LimitSchema.parse(0)).toThrow());
  it("rejects over 1000", () => expect(() => LimitSchema.parse(1001)).toThrow());
  it("rejects non-integer", () => expect(() => LimitSchema.parse(1.5)).toThrow());
});

describe("OffsetSchema", () => {
  it("accepts valid offset", () => expect(OffsetSchema.parse(10)).toBe(10));
  it("defaults to 0", () => expect(OffsetSchema.parse(undefined)).toBe(0));
  it("rejects negative", () => expect(() => OffsetSchema.parse(-1)).toThrow());
});

describe("WhereClauseSchema", () => {
  it("accepts normal conditions", () => {
    expect(WhereClauseSchema.parse("id = 1")).toBe("id = 1");
    expect(WhereClauseSchema.parse("status = 'active' AND age > 18")).toBe("status = 'active' AND age > 18");
    expect(WhereClauseSchema.parse("name = 'delete_me'")).toBe("name = 'delete_me'");
  });

  it("accepts undefined (optional)", () => expect(WhereClauseSchema.parse(undefined)).toBeUndefined());

  it("rejects SQL comment injection (--)", () => {
    expect(() => WhereClauseSchema.parse("1=1 -- comment")).toThrow();
  });

  it("rejects block comment injection (/* */)", () => {
    expect(() => WhereClauseSchema.parse("1=1 /* comment */")).toThrow();
  });

  it("rejects semicolon + DROP", () => {
    expect(() => WhereClauseSchema.parse("1=1; DROP TABLE users")).toThrow();
  });

  it("rejects semicolon + DELETE", () => {
    expect(() => WhereClauseSchema.parse("1=1; DELETE FROM users")).toThrow();
  });

  it("rejects semicolon + TRUNCATE", () => {
    expect(() => WhereClauseSchema.parse("1=1; TRUNCATE TABLE users")).toThrow();
  });

  it("rejects semicolon + EXEC", () => {
    expect(() => WhereClauseSchema.parse("1=1; EXEC xp_cmdshell('cmd')")).toThrow();
  });

  it("rejects strings over 1000 chars", () => {
    expect(() => WhereClauseSchema.parse("a".repeat(1001))).toThrow();
  });
});

describe("ColumnsSchema", () => {
  it("accepts array of valid column names", () => {
    expect(ColumnsSchema.parse(["id", "name", "email"])).toEqual(["id", "name", "email"]);
  });

  it("accepts undefined (optional)", () => expect(ColumnsSchema.parse(undefined)).toBeUndefined());

  it("rejects columns with invalid characters", () => {
    expect(() => ColumnsSchema.parse(["id", "invalid-col"])).toThrow();
  });
});
