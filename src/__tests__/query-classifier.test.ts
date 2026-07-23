import { describe, it, expect } from "vitest";
import { classifyQuery, validateWhereFragment } from "../services/query-classifier.js";
import { DatabaseType } from "../types.js";

const dialects = [DatabaseType.POSTGRESQL, DatabaseType.COCKROACHDB, DatabaseType.MYSQL, DatabaseType.SQLSERVER];

describe("classifyQuery", () => {
  for (const dbType of dialects) {
    describe(dbType, () => {
      it("classifies SELECT", () => {
        const c = classifyQuery("SELECT * FROM users", dbType);
        expect(c.type).toBe("SELECT");
        expect(c.isDestructive).toBe(false);
      });

      it("classifies INSERT", () => {
        const c = classifyQuery("INSERT INTO users (id) VALUES (1)", dbType);
        expect(c.type).toBe("DML");
        expect(c.isDestructive).toBe(false);
      });

      it("classifies UPDATE with WHERE as non-destructive", () => {
        const c = classifyQuery("UPDATE users SET name = 'x' WHERE id = 1", dbType);
        expect(c.type).toBe("DML");
        expect(c.hasWhere).toBe(true);
        expect(c.isDestructive).toBe(false);
      });

      it("classifies UPDATE without WHERE as destructive", () => {
        const c = classifyQuery("UPDATE users SET name = 'x'", dbType);
        expect(c.type).toBe("DML");
        expect(c.hasWhere).toBe(false);
        expect(c.isDestructive).toBe(true);
      });

      it("classifies DELETE without WHERE as destructive", () => {
        const c = classifyQuery("DELETE FROM users", dbType);
        expect(c.type).toBe("DML");
        expect(c.isDestructive).toBe(true);
      });

      it("classifies DELETE with WHERE as non-destructive", () => {
        const c = classifyQuery("DELETE FROM users WHERE id = 1", dbType);
        expect(c.isDestructive).toBe(false);
      });

      it("classifies DROP as destructive DDL", () => {
        const c = classifyQuery("DROP TABLE users", dbType);
        expect(c.type).toBe("DDL");
        expect(c.isDestructive).toBe(true);
      });

      it("classifies TRUNCATE as destructive DDL", () => {
        const c = classifyQuery("TRUNCATE TABLE users", dbType);
        expect(c.type).toBe("DDL");
        expect(c.isDestructive).toBe(true);
      });

      it("classifies CREATE TABLE as non-destructive DDL", () => {
        const c = classifyQuery("CREATE TABLE t (id INT)", dbType);
        expect(c.type).toBe("DDL");
        expect(c.isDestructive).toBe(false);
      });
    });
  }

  it("classifies DB2 queries (native dialect support)", () => {
    expect(classifyQuery("SELECT * FROM users", DatabaseType.DB2).type).toBe("SELECT");
    expect(classifyQuery("DROP TABLE users", DatabaseType.DB2).isDestructive).toBe(true);
    expect(classifyQuery("DELETE FROM users", DatabaseType.DB2).isDestructive).toBe(true);
    expect(classifyQuery("DELETE FROM users WHERE id = 1", DatabaseType.DB2).isDestructive).toBe(false);
  });

  it("falls back gracefully on malformed SQL without throwing", () => {
    expect(() => classifyQuery("THIS IS NOT $$$ VALID SQL !!!", DatabaseType.POSTGRESQL)).not.toThrow();
    const c = classifyQuery("SELECT FROM WHERE ???", DatabaseType.POSTGRESQL);
    expect(c.parseError).toBeDefined();
  });

  it("regex fallback classifies DROP as destructive even when unparseable", () => {
    const c = classifyQuery("DROP TABLE $$$invalid$$$", DatabaseType.POSTGRESQL);
    expect(c.parseError).toBeDefined();
    expect(c.isDestructive).toBe(true);
  });

  describe("EXPLAIN/ANALYZE (node-sql-parser can't parse these in any dialect)", () => {
    const allDialects = [DatabaseType.POSTGRESQL, DatabaseType.COCKROACHDB, DatabaseType.MYSQL, DatabaseType.SQLSERVER, DatabaseType.SQLITE, DatabaseType.DB2];

    for (const dbType of allDialects) {
      it(`classifies EXPLAIN as non-destructive EXPLAIN type (${dbType})`, () => {
        const c = classifyQuery("EXPLAIN SELECT * FROM users", dbType);
        expect(c.type).toBe("EXPLAIN");
        expect(c.isDestructive).toBe(false);
        expect(c.parseError).toBeUndefined();
      });

      it(`classifies ANALYZE as non-destructive EXPLAIN type (${dbType})`, () => {
        const c = classifyQuery("ANALYZE users", dbType);
        expect(c.type).toBe("EXPLAIN");
        expect(c.isDestructive).toBe(false);
      });
    }

    it("classifies EXPLAIN ANALYZE (Postgres combined form)", () => {
      const c = classifyQuery("EXPLAIN ANALYZE SELECT * FROM users", DatabaseType.POSTGRESQL);
      expect(c.type).toBe("EXPLAIN");
    });

    it("classifies EXPLAIN QUERY PLAN (SQLite form)", () => {
      const c = classifyQuery("EXPLAIN QUERY PLAN SELECT * FROM users", DatabaseType.SQLITE);
      expect(c.type).toBe("EXPLAIN");
    });

    it("classifies ANALYZE TABLE (MySQL form)", () => {
      const c = classifyQuery("ANALYZE TABLE users", DatabaseType.MYSQL);
      expect(c.type).toBe("EXPLAIN");
    });

    it("is case-insensitive and tolerates leading whitespace", () => {
      expect(classifyQuery("  explain select 1", DatabaseType.POSTGRESQL).type).toBe("EXPLAIN");
      expect(classifyQuery("Explain Select 1", DatabaseType.MYSQL).type).toBe("EXPLAIN");
    });

    it("never requires confirmation, even without WHERE", () => {
      const c = classifyQuery("ANALYZE users", DatabaseType.POSTGRESQL);
      expect(c.isDestructive).toBe(false);
      expect(c.hasWhere).toBe(false);
    });
  });
});

describe("validateWhereFragment", () => {
  it("accepts a simple boolean expression", () => {
    expect(validateWhereFragment("age > 18", DatabaseType.POSTGRESQL).valid).toBe(true);
  });

  it("accepts a compound boolean expression", () => {
    expect(validateWhereFragment("age > 18 AND status = 'active'", DatabaseType.POSTGRESQL).valid).toBe(true);
  });

  it("rejects a stacked statement", () => {
    const result = validateWhereFragment("1=1; DROP TABLE users", DatabaseType.POSTGRESQL);
    expect(result.valid).toBe(false);
  });

  it("rejects a subquery referencing another table", () => {
    const result = validateWhereFragment("id IN (SELECT id FROM other_table)", DatabaseType.POSTGRESQL);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("other_table");
  });

  it("rejects malformed SQL", () => {
    expect(validateWhereFragment("this is $$$ not valid", DatabaseType.POSTGRESQL).valid).toBe(false);
  });
});
