import { describe, expect, it } from "vitest";
import { resolveClientAuthReadiness } from "../../client/src/auth-config";

const backendReady = { configured: true, publishableKey: "pk_test_matching" };

describe("browser Clerk readiness", () => {
  it("waits for the backend readiness response", () => {
    expect(resolveClientAuthReadiness("pk_test_matching", undefined)).toBe("checking");
  });

  it("does not mount Clerk when the backend is unconfigured or unreachable", () => {
    expect(resolveClientAuthReadiness("pk_test_matching", { configured: false, publishableKey: null })).toBe("server-unconfigured");
    expect(resolveClientAuthReadiness("pk_test_matching", null)).toBe("status-unavailable");
  });

  it("requires a public key and an exact match with the backend Clerk instance", () => {
    expect(resolveClientAuthReadiness("", backendReady)).toBe("client-unconfigured");
    expect(resolveClientAuthReadiness("pk_test_other", backendReady)).toBe("key-mismatch");
    expect(resolveClientAuthReadiness("pk_test_matching", { configured: true, publishableKey: null })).toBe("key-mismatch");
    expect(resolveClientAuthReadiness("pk_test_matching", backendReady)).toBe("ready");
  });
});
