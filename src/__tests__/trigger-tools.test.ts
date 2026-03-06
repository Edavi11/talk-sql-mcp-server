import { describe, it, expect } from "vitest";
import { CreateTriggerInputSchema } from "../tools/trigger-tools.js";

describe("CreateTriggerInputSchema", () => {
  const validTrigger = {
    table: "orders",
    trigger_name: "trg_orders_audit",
    timing: "AFTER" as const,
    event: "INSERT" as const,
    procedure: "SET NEW.updated_at = NOW();",
  };

  it("accepts a valid trigger definition", () => {
    expect(() => CreateTriggerInputSchema.parse(validTrigger)).not.toThrow();
  });

  it("accepts all timing values", () => {
    expect(() => CreateTriggerInputSchema.parse({ ...validTrigger, timing: "BEFORE" })).not.toThrow();
    expect(() => CreateTriggerInputSchema.parse({ ...validTrigger, timing: "AFTER" })).not.toThrow();
  });

  it("accepts all event values", () => {
    expect(() => CreateTriggerInputSchema.parse({ ...validTrigger, event: "INSERT" })).not.toThrow();
    expect(() => CreateTriggerInputSchema.parse({ ...validTrigger, event: "UPDATE" })).not.toThrow();
    expect(() => CreateTriggerInputSchema.parse({ ...validTrigger, event: "DELETE" })).not.toThrow();
  });

  it("rejects invalid timing", () => {
    expect(() => CreateTriggerInputSchema.parse({ ...validTrigger, timing: "DURING" })).toThrow();
  });

  it("rejects invalid event", () => {
    expect(() => CreateTriggerInputSchema.parse({ ...validTrigger, event: "SELECT" })).toThrow();
  });

  it("rejects trigger_name with special characters", () => {
    expect(() => CreateTriggerInputSchema.parse({ ...validTrigger, trigger_name: "trg-invalid" })).toThrow();
  });

  it("rejects empty trigger_name", () => {
    expect(() => CreateTriggerInputSchema.parse({ ...validTrigger, trigger_name: "" })).toThrow();
  });

  it("rejects procedure over 10000 chars", () => {
    expect(() => CreateTriggerInputSchema.parse({ ...validTrigger, procedure: "a".repeat(10001) })).toThrow();
  });

  it("rejects empty procedure", () => {
    expect(() => CreateTriggerInputSchema.parse({ ...validTrigger, procedure: "" })).toThrow();
  });

  it("accepts optional schema", () => {
    expect(() => CreateTriggerInputSchema.parse({ ...validTrigger, schema: "dbo" })).not.toThrow();
  });

  it("accepts optional connection_string", () => {
    expect(() => CreateTriggerInputSchema.parse({ ...validTrigger, connection_string: "sqlite://test.db" })).not.toThrow();
  });
});
