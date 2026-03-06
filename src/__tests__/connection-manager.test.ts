import { describe, it, expect } from "vitest";
import { detectDatabaseType, sanitizeIdentifier } from "../services/connection-manager.js";
import { DatabaseType } from "../types.js";

describe("detectDatabaseType", () => {
  it("detects PostgreSQL from postgresql://", () => {
    expect(detectDatabaseType("postgresql://user:pass@localhost:5432/db")).toBe(DatabaseType.POSTGRESQL);
  });

  it("detects PostgreSQL from postgres://", () => {
    expect(detectDatabaseType("postgres://user:pass@localhost/db")).toBe(DatabaseType.POSTGRESQL);
  });

  it("detects MySQL from mysql://", () => {
    expect(detectDatabaseType("mysql://user:pass@localhost:3306/db")).toBe(DatabaseType.MYSQL);
  });

  it("detects MySQL from mysql2://", () => {
    expect(detectDatabaseType("mysql2://user:pass@localhost/db")).toBe(DatabaseType.MYSQL);
  });

  it("detects SQL Server from mssql://", () => {
    expect(detectDatabaseType("mssql://user:pass@localhost:1433/db")).toBe(DatabaseType.SQLSERVER);
  });

  it("detects SQL Server from sqlserver://", () => {
    expect(detectDatabaseType("sqlserver://user:pass@localhost/db")).toBe(DatabaseType.SQLSERVER);
  });

  it("detects SQL Server from sql://", () => {
    expect(detectDatabaseType("sql://user:pass@localhost/db")).toBe(DatabaseType.SQLSERVER);
  });

  it("detects SQLite from sqlite://", () => {
    expect(detectDatabaseType("sqlite:///path/to/file.db")).toBe(DatabaseType.SQLITE);
  });

  it("detects SQLite from sqlite:", () => {
    expect(detectDatabaseType("sqlite:/path/to/file.db")).toBe(DatabaseType.SQLITE);
  });

  it("detects SQLite from .db extension", () => {
    expect(detectDatabaseType("./mydb.db")).toBe(DatabaseType.SQLITE);
  });

  it("detects SQLite from .sqlite extension", () => {
    expect(detectDatabaseType("./mydb.sqlite")).toBe(DatabaseType.SQLITE);
  });

  it("detects SQLite from .sqlite3 extension", () => {
    expect(detectDatabaseType("./mydb.sqlite3")).toBe(DatabaseType.SQLITE);
  });

  it("is case-insensitive", () => {
    expect(detectDatabaseType("POSTGRESQL://user:pass@localhost/db")).toBe(DatabaseType.POSTGRESQL);
    expect(detectDatabaseType("MYSQL://user:pass@localhost/db")).toBe(DatabaseType.MYSQL);
  });

  it("throws for unsupported connection strings", () => {
    expect(() => detectDatabaseType("mongodb://localhost/db")).toThrow("Unsupported database type");
    expect(() => detectDatabaseType("redis://localhost")).toThrow("Unsupported database type");
    expect(() => detectDatabaseType("")).toThrow("Unsupported database type");
  });
});

describe("sanitizeIdentifier", () => {
  it("allows alphanumeric characters", () => {
    expect(sanitizeIdentifier("users123")).toBe("users123");
  });

  it("allows underscores", () => {
    expect(sanitizeIdentifier("user_id")).toBe("user_id");
  });

  it("allows dots for schema.table notation", () => {
    expect(sanitizeIdentifier("dbo.users")).toBe("dbo.users");
  });

  it("allows hyphens", () => {
    expect(sanitizeIdentifier("my-table")).toBe("my-table");
  });

  it("strips semicolons", () => {
    expect(sanitizeIdentifier("users;DROP TABLE users")).toBe("usersDROPTABLEusers");
  });

  it("strips quotes", () => {
    expect(sanitizeIdentifier("users'OR'1'='1")).toBe("usersOR11");
  });

  it("strips spaces", () => {
    expect(sanitizeIdentifier("my table")).toBe("mytable");
  });

  it("strips special characters", () => {
    expect(sanitizeIdentifier("table$name!")).toBe("tablename");
  });

  it("returns empty string for fully invalid input", () => {
    expect(sanitizeIdentifier("!@#$%^&*()")).toBe("");
  });
});
