import { describe, expect, it } from "vitest";
import type { User } from "../../drizzle/schema";
import { canAccessSellerFulfillment, canBootstrapInitialAdmin, canTransitionSellerApplication, hasCapability, requireCapability, requireOwnership, requireRole } from "./authorization";

function user(role: User["role"]): User {
  const now = new Date();
  return {
    id: 1,
    openId: "test-account",
    name: "Test Account",
    email: "test@example.com",
    loginMethod: "manus",
    role,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

describe("account authorization", () => {
  it("grants only the intended capabilities to each role", () => {
    expect(hasCapability(user("customer"), "account:read")).toBe(true);
    expect(hasCapability(user("customer"), "seller:apply")).toBe(true);
    expect(hasCapability(user("customer"), "seller:review")).toBe(false);
    expect(hasCapability(user("seller"), "seller:dashboard")).toBe(true);
    expect(hasCapability(user("seller"), "seller:apply")).toBe(false);
    expect(hasCapability(user("seller"), "staff:manage")).toBe(false);
    expect(hasCapability(user("staff"), "seller:review")).toBe(true);
    expect(hasCapability(user("staff"), "admin:manage")).toBe(false);
    expect(hasCapability(user("admin"), "admin:manage")).toBe(true);
  });

  it("denies customer elevation attempts through role and capability guards", () => {
    expect(() => requireCapability(user("customer"), "seller:review")).toThrow("You do not have permission");
    expect(() => requireRole(user("customer"), ["staff", "admin"])).toThrow("You do not have permission");
  });

  it("fails closed for an unknown role and accepts only valid seller lifecycle transitions", () => {
    expect(hasCapability({ role: "constructor" } as unknown as User, "admin:manage")).toBe(false);
    expect(() => requireRole({ ...user("customer"), role: "constructor" } as unknown as User, ["admin"])).toThrow("You do not have permission");
    expect(canTransitionSellerApplication("pending", "approved")).toBe(true);
    expect(canTransitionSellerApplication("pending", "rejected")).toBe(true);
    expect(canTransitionSellerApplication("approved", "suspended")).toBe(true);
    expect(canTransitionSellerApplication("suspended", "approved")).toBe(true);
    expect(canTransitionSellerApplication("pending", "suspended")).toBe(false);
    expect(canTransitionSellerApplication("rejected", "approved")).toBe(false);
  });

  it("requires resource ownership for individual seller data", () => {
    expect(() => requireOwnership(21, 22)).toThrow("You do not have permission for this resource");
    expect(() => requireOwnership(21, 21)).not.toThrow();
  });

  it("keeps fulfillment access for suspended sellers without granting it to other roles", () => {
    expect(canAccessSellerFulfillment("seller", "approved")).toBe(true);
    expect(canAccessSellerFulfillment("customer", "suspended")).toBe(true);
    expect(canAccessSellerFulfillment("customer", null)).toBe(false);
    expect(canAccessSellerFulfillment("staff", "suspended")).toBe(false);
    expect(canAccessSellerFulfillment("admin", "suspended")).toBe(false);
  });

  it("bootstraps only the configured first owner identity, once and before another admin exists", () => {
    const valid = {
      configuredOwnerOpenId: "owner-open-id",
      authenticatedOpenId: "owner-open-id",
      bootstrapExists: false,
      administratorExists: false,
      ownerRole: "customer" as const,
    };
    expect(canBootstrapInitialAdmin(valid)).toBe(true);
    expect(canBootstrapInitialAdmin({ ...valid, configuredOwnerOpenId: "" })).toBe(false);
    expect(canBootstrapInitialAdmin({ ...valid, authenticatedOpenId: "different-user" })).toBe(false);
    expect(canBootstrapInitialAdmin({ ...valid, bootstrapExists: true })).toBe(false);
    expect(canBootstrapInitialAdmin({ ...valid, administratorExists: true })).toBe(false);
    expect(canBootstrapInitialAdmin({ ...valid, ownerRole: "seller" })).toBe(false);
  });
});
