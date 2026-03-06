import { describe, it, expect } from "vitest";
import { ColumnDefinitionSchema, ForeignKeyDefinitionSchema } from "../tools/ddl-tools.js";

describe("ColumnDefinitionSchema", () => {
  const validColumn = { name: "user_id", type: "INT" };

  it("accepts a valid column definition", () => {
    expect(() => ColumnDefinitionSchema.parse(validColumn)).not.toThrow();
  });

  it("accepts all optional fields", () => {
    expect(() => ColumnDefinitionSchema.parse({
      name: "id",
      type: "INT",
      nullable: false,
      primary_key: true,
      unique: false,
      default: "0",
      auto_increment: true,
    })).not.toThrow();
  });

  it("rejects column name with special characters", () => {
    expect(() => ColumnDefinitionSchema.parse({ name: "user-id", type: "INT" })).toThrow();
  });

  it("rejects empty column name", () => {
    expect(() => ColumnDefinitionSchema.parse({ name: "", type: "INT" })).toThrow();
  });

  it("rejects column type with SQL injection characters", () => {
    expect(() => ColumnDefinitionSchema.parse({ name: "id", type: "INT; DROP TABLE users" })).toThrow();
  });

  it("accepts complex valid types like VARCHAR(255)", () => {
    expect(() => ColumnDefinitionSchema.parse({ name: "email", type: "VARCHAR(255)" })).not.toThrow();
  });

  it("accepts DECIMAL(10,2) type", () => {
    expect(() => ColumnDefinitionSchema.parse({ name: "price", type: "DECIMAL(10,2)" })).not.toThrow();
  });

  it("rejects default value with dangerous characters", () => {
    expect(() => ColumnDefinitionSchema.parse({ name: "col", type: "INT", default: "0; DROP TABLE users" })).toThrow();
  });

  it("accepts safe default values", () => {
    expect(() => ColumnDefinitionSchema.parse({ name: "col", type: "VARCHAR(10)", default: "active" })).not.toThrow();
    expect(() => ColumnDefinitionSchema.parse({ name: "col", type: "INT", default: "0" })).not.toThrow();
    expect(() => ColumnDefinitionSchema.parse({ name: "col", type: "TIMESTAMP", default: "CURRENT_TIMESTAMP" })).not.toThrow();
  });

  it("rejects unknown extra fields (strict mode)", () => {
    expect(() => ColumnDefinitionSchema.parse({ name: "id", type: "INT", extra: "field" })).toThrow();
  });
});

describe("ForeignKeyDefinitionSchema", () => {
  const validFK = {
    column: "user_id",
    references_table: "users",
    references_column: "id",
  };

  it("accepts a valid foreign key", () => {
    expect(() => ForeignKeyDefinitionSchema.parse(validFK)).not.toThrow();
  });

  it("accepts all on_delete/on_update options", () => {
    const actions = ["CASCADE", "SET NULL", "RESTRICT", "NO ACTION"] as const;
    for (const action of actions) {
      expect(() => ForeignKeyDefinitionSchema.parse({
        ...validFK,
        on_delete: action,
        on_update: action,
      })).not.toThrow();
    }
  });

  it("rejects invalid on_delete value", () => {
    expect(() => ForeignKeyDefinitionSchema.parse({ ...validFK, on_delete: "INVALID" })).toThrow();
  });

  it("rejects column names with special characters", () => {
    expect(() => ForeignKeyDefinitionSchema.parse({ ...validFK, column: "user-id" })).toThrow();
  });

  it("rejects references_table with special characters", () => {
    expect(() => ForeignKeyDefinitionSchema.parse({ ...validFK, references_table: "users; DROP TABLE" })).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => ForeignKeyDefinitionSchema.parse({ column: "user_id" })).toThrow();
  });
});
