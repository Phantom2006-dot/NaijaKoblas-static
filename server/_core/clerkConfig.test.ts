import { describe, expect, it } from "vitest";
import {
  getClerkMiddlewareOptions,
  getClerkServerConfig,
  getPublicClerkStatus,
  parseConfiguredAppOrigin,
} from "./clerkConfig";

const validClerkEnvironment = {
  clerkPublishableKey: "pk_test_sample",
  clerkSecretKey: "sk_test_sample",
  appBaseUrl: "https://naijakoblas-static.vercel.app",
  isProduction: true,
};

describe("Clerk server configuration", () => {
  it("keeps authentication disabled when neither server key is configured", () => {
    const config = getClerkServerConfig({ isProduction: true });
    expect(config.enabled).toBe(false);
    expect(config.authorizedParties).toEqual([]);
    expect(getClerkMiddlewareOptions(config)).toBeNull();
    expect(getPublicClerkStatus(config)).toEqual({ configured: false, publishableKey: null });
  });

  it("requires the server key pair together", () => {
    expect(() => getClerkServerConfig({ clerkPublishableKey: "pk_test_sample" }))
      .toThrow("CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY must be configured together.");
    expect(() => getClerkServerConfig({ clerkSecretKey: "sk_test_sample" }))
      .toThrow("CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY must be configured together.");
  });

  it("requires a valid public origin before enabling Clerk", () => {
    expect(() => getClerkServerConfig({ ...validClerkEnvironment, appBaseUrl: "" }))
      .toThrow("APP_BASE_URL is required when Clerk authentication is configured.");
    expect(() => getClerkServerConfig({ ...validClerkEnvironment, appBaseUrl: "not-a-url" }))
      .toThrow("APP_BASE_URL must be a valid absolute storefront origin.");
  });

  it("rejects production HTTP origins and non-origin URL components", () => {
    expect(() => parseConfiguredAppOrigin("http://naijakoblas.example", true)).toThrow("must use HTTPS");
    expect(() => parseConfiguredAppOrigin("https://naijakoblas.example/path", true)).toThrow("must contain only the storefront origin");
    expect(() => parseConfiguredAppOrigin("https://user:pass@naijakoblas.example", true)).toThrow("must contain only the storefront origin");
    expect(() => parseConfiguredAppOrigin("https://naijakoblas.example/?mode=test", true)).toThrow("must contain only the storefront origin");
  });

  it("allows plain HTTP only for loopback development and normalizes the origin", () => {
    expect(parseConfiguredAppOrigin("http://localhost:3000/", false)).toBe("http://localhost:3000");
    expect(parseConfiguredAppOrigin("http://127.0.0.1:3000", false)).toBe("http://127.0.0.1:3000");
    expect(() => parseConfiguredAppOrigin("http://example.com", false)).toThrow("must use HTTPS");
  });

  it("passes exactly the configured storefront origin to Clerk as an authorized party", () => {
    const config = getClerkServerConfig(validClerkEnvironment);
    expect(config.appOrigin).toBe("https://naijakoblas-static.vercel.app");
    expect(getClerkMiddlewareOptions(config)).toEqual({
      secretKey: "sk_test_sample",
      publishableKey: "pk_test_sample",
      authorizedParties: ["https://naijakoblas-static.vercel.app"],
    });
    expect(getPublicClerkStatus(config)).toEqual({ configured: true, publishableKey: "pk_test_sample" });
    expect(JSON.stringify(getPublicClerkStatus(config))).not.toContain("sk_test_sample");
  });
});
