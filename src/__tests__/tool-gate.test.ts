import { describe, it, expect, vi, afterEach } from "vitest";
import { withGate, GateBlockedResult } from "../services/tool-gate.js";

type StubResult = { content: Array<{ type: "text"; text: string }> };

const originalEnv = process.env.TALK_SQL_READONLY;

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.TALK_SQL_READONLY;
  } else {
    process.env.TALK_SQL_READONLY = originalEnv;
  }
});

describe("withGate - always-read", () => {
  it("always calls the handler regardless of read-only mode", async () => {
    process.env.TALK_SQL_READONLY = "true";
    const handler = vi.fn<() => Promise<StubResult>>().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const gated = withGate("db_select", { kind: "always-read" }, handler);

    const result = await gated({ table: "users" });

    expect(handler).toHaveBeenCalledWith({ table: "users" });
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });
});

describe("withGate - always-write", () => {
  it("passes through when read-only mode is off", async () => {
    delete process.env.TALK_SQL_READONLY;
    const handler = vi.fn<() => Promise<StubResult>>().mockResolvedValue({ content: [{ type: "text", text: "created" }] });
    const gated = withGate("db_create_table", { kind: "always-write" }, handler);

    const result = await gated({ table: "t" });

    expect(handler).toHaveBeenCalled();
    expect(result).toEqual({ content: [{ type: "text", text: "created" }] });
  });

  it("blocks unconditionally when read-only mode is on", async () => {
    process.env.TALK_SQL_READONLY = "true";
    const handler = vi.fn<() => Promise<StubResult>>();
    const gated = withGate("db_create_table", { kind: "always-write" }, handler);

    const result = await gated({ table: "t" });

    expect(handler).not.toHaveBeenCalled();
    expect((result as GateBlockedResult).structuredContent).toEqual({ blocked: true, reason: "readonly_mode" });
    expect(result.content[0].text).toContain("read-only mode");
  });
});

describe("withGate - dynamic-sql (db_query)", () => {
  it("SELECT always passes through, readonly on or off", async () => {
    const handler = vi.fn<() => Promise<StubResult>>().mockResolvedValue({ content: [{ type: "text", text: "rows" }] });
    const gated = withGate("db_query", { kind: "dynamic-sql" }, handler);

    process.env.TALK_SQL_READONLY = "true";
    await gated({ query: "SELECT * FROM users", connection_string: "postgresql://u:p@h/db" });
    expect(handler).toHaveBeenCalledTimes(1);

    delete process.env.TALK_SQL_READONLY;
    await gated({ query: "SELECT * FROM users", connection_string: "postgresql://u:p@h/db" });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("blocks INSERT when read-only mode is on", async () => {
    process.env.TALK_SQL_READONLY = "true";
    const handler = vi.fn<() => Promise<StubResult>>();
    const gated = withGate("db_query", { kind: "dynamic-sql" }, handler);

    const result = await gated({ query: "INSERT INTO users (id) VALUES (1)", connection_string: "postgresql://u:p@h/db" });

    expect(handler).not.toHaveBeenCalled();
    expect((result as GateBlockedResult).structuredContent).toMatchObject({ blocked: true, reason: "readonly_mode" });
  });

  it("blocks UPDATE-with-WHERE when read-only mode is on", async () => {
    process.env.TALK_SQL_READONLY = "true";
    const handler = vi.fn<() => Promise<StubResult>>();
    const gated = withGate("db_query", { kind: "dynamic-sql" }, handler);

    const result = await gated({ query: "UPDATE users SET x=1 WHERE id=1", connection_string: "postgresql://u:p@h/db" });

    expect(handler).not.toHaveBeenCalled();
    expect((result as GateBlockedResult).structuredContent).toMatchObject({ reason: "readonly_mode" });
  });

  it("blocks DROP when read-only mode is on (readonly message, not confirm)", async () => {
    process.env.TALK_SQL_READONLY = "true";
    const handler = vi.fn<() => Promise<StubResult>>();
    const gated = withGate("db_query", { kind: "dynamic-sql" }, handler);

    const result = await gated({ query: "DROP TABLE users", connection_string: "postgresql://u:p@h/db" });

    expect(handler).not.toHaveBeenCalled();
    expect((result as GateBlockedResult).structuredContent).toMatchObject({ reason: "readonly_mode" });
  });

  it("blocks DROP pending confirmation when read-only mode is off", async () => {
    delete process.env.TALK_SQL_READONLY;
    const handler = vi.fn<() => Promise<StubResult>>();
    const gated = withGate("db_query", { kind: "dynamic-sql" }, handler);

    const result = await gated({ query: "DROP TABLE users", confirm: false, connection_string: "postgresql://u:p@h/db" });

    expect(handler).not.toHaveBeenCalled();
    expect((result as GateBlockedResult).structuredContent).toMatchObject({ blocked: true, reason: "destructive_confirmation_required" });
  });

  it("executes DROP when confirm:true is passed", async () => {
    delete process.env.TALK_SQL_READONLY;
    const handler = vi.fn<() => Promise<StubResult>>().mockResolvedValue({ content: [{ type: "text", text: "dropped" }] });
    const gated = withGate("db_query", { kind: "dynamic-sql" }, handler);

    const result = await gated({ query: "DROP TABLE users", confirm: true, connection_string: "postgresql://u:p@h/db" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ content: [{ type: "text", text: "dropped" }] });
  });

  it("UPDATE with WHERE and no confirm passes through (not destructive)", async () => {
    delete process.env.TALK_SQL_READONLY;
    const handler = vi.fn<() => Promise<StubResult>>().mockResolvedValue({ content: [{ type: "text", text: "updated" }] });
    const gated = withGate("db_query", { kind: "dynamic-sql" }, handler);

    const result = await gated({ query: "UPDATE users SET x=1 WHERE id=1", confirm: false, connection_string: "postgresql://u:p@h/db" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ content: [{ type: "text", text: "updated" }] });
  });

  it("UPDATE without WHERE and no confirm is blocked pending confirmation", async () => {
    delete process.env.TALK_SQL_READONLY;
    const handler = vi.fn<() => Promise<StubResult>>();
    const gated = withGate("db_query", { kind: "dynamic-sql" }, handler);

    const result = await gated({ query: "UPDATE users SET x=1", confirm: false, connection_string: "postgresql://u:p@h/db" });

    expect(handler).not.toHaveBeenCalled();
    expect((result as GateBlockedResult).structuredContent).toMatchObject({ reason: "destructive_confirmation_required" });
  });

  it("UPDATE without WHERE with confirm:true passes through", async () => {
    delete process.env.TALK_SQL_READONLY;
    const handler = vi.fn<() => Promise<StubResult>>().mockResolvedValue({ content: [{ type: "text", text: "updated" }] });
    const gated = withGate("db_query", { kind: "dynamic-sql" }, handler);

    const result = await gated({ query: "UPDATE users SET x=1", confirm: true, connection_string: "postgresql://u:p@h/db" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ content: [{ type: "text", text: "updated" }] });
  });

  it("INSERT never needs confirmation", async () => {
    delete process.env.TALK_SQL_READONLY;
    const handler = vi.fn<() => Promise<StubResult>>().mockResolvedValue({ content: [{ type: "text", text: "inserted" }] });
    const gated = withGate("db_query", { kind: "dynamic-sql" }, handler);

    const result = await gated({ query: "INSERT INTO users (id) VALUES (1)", confirm: false, connection_string: "postgresql://u:p@h/db" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ content: [{ type: "text", text: "inserted" }] });
  });

  it("falls back to a generic dialect when no connection_string is present", async () => {
    delete process.env.TALK_SQL_READONLY;
    const handler = vi.fn<() => Promise<StubResult>>().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const gated = withGate("db_query", { kind: "dynamic-sql" }, handler);

    const result = await gated({ query: "SELECT 1", confirm: false });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });
});
