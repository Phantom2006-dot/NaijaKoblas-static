import { describe, expect, it } from "vitest";
import { createUploadConcurrencyGate } from "./concurrency";

describe("product upload concurrency gate", () => {
  it("holds a slot until the async route explicitly releases it", () => {
    const gate = createUploadConcurrencyGate(1);
    const release = gate.acquire();

    expect(release).toBeTypeOf("function");
    expect(gate.activeCount()).toBe(1);
    expect(gate.acquire()).toBeNull();

    release?.();
    expect(gate.activeCount()).toBe(0);
    expect(gate.acquire()).toBeTypeOf("function");
  });

  it("makes completion cleanup idempotent", () => {
    const gate = createUploadConcurrencyGate(1);
    const release = gate.acquire();

    release?.();
    release?.();

    expect(gate.activeCount()).toBe(0);
    expect(gate.acquire()).toBeTypeOf("function");
  });

  it("rejects an invalid capacity", () => {
    expect(() => createUploadConcurrencyGate(0)).toThrow("positive integer");
    expect(() => createUploadConcurrencyGate(1.5)).toThrow("positive integer");
  });
});
