import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConnectionString, CHARACTER_LIMIT, MAX_QUERY_LENGTH, DEFAULT_LIMIT, MAX_LIMIT, DEFAULT_OFFSET } from "../constants.js";

describe("constants", () => {
  it("CHARACTER_LIMIT is 25000", () => expect(CHARACTER_LIMIT).toBe(25000));
  it("MAX_QUERY_LENGTH is 100000", () => expect(MAX_QUERY_LENGTH).toBe(100000));
  it("DEFAULT_LIMIT is 100", () => expect(DEFAULT_LIMIT).toBe(100));
  it("MAX_LIMIT is 1000", () => expect(MAX_LIMIT).toBe(1000));
  it("DEFAULT_OFFSET is 0", () => expect(DEFAULT_OFFSET).toBe(0));
});

describe("getConnectionString", () => {
  const originalEnv = process.env.SQL_CONNECTION_STRING;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SQL_CONNECTION_STRING;
    } else {
      process.env.SQL_CONNECTION_STRING = originalEnv;
    }
  });

  it("returns provided connection string", () => {
    const cs = "postgresql://user:pass@localhost/db";
    expect(getConnectionString(cs)).toBe(cs);
  });

  it("falls back to SQL_CONNECTION_STRING env variable", () => {
    process.env.SQL_CONNECTION_STRING = "mysql://user:pass@localhost/db";
    expect(getConnectionString(undefined)).toBe("mysql://user:pass@localhost/db");
  });

  it("falls back to env when empty string is provided", () => {
    process.env.SQL_CONNECTION_STRING = "mysql://user:pass@localhost/db";
    expect(getConnectionString("")).toBe("mysql://user:pass@localhost/db");
  });

  it("falls back to env when whitespace string is provided", () => {
    process.env.SQL_CONNECTION_STRING = "mysql://user:pass@localhost/db";
    expect(getConnectionString("   ")).toBe("mysql://user:pass@localhost/db");
  });

  it("throws when no connection string and no env variable", () => {
    delete process.env.SQL_CONNECTION_STRING;
    expect(() => getConnectionString(undefined)).toThrow("Connection string is required");
  });

  it("throws when env variable is empty", () => {
    process.env.SQL_CONNECTION_STRING = "";
    expect(() => getConnectionString(undefined)).toThrow("Connection string is required");
  });
});
