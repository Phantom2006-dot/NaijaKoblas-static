import { describe, expect, it } from "vitest";
import { decideSellerActivation } from "./seller-activation";

describe("decideSellerActivation", () => {
  it("activates a verified customer with no application or store", () => {
    expect(decideSellerActivation({ role: "customer", applicationStatus: null, storeExists: false, storeActive: false }))
      .toEqual({ kind: "activate" });
  });

  it("lets a customer convert a pending legacy application to direct activation", () => {
    expect(decideSellerActivation({ role: "customer", applicationStatus: "pending", storeExists: false, storeActive: false }))
      .toEqual({ kind: "activate" });
  });

  it("repairs an approved legacy customer role when its store is still active", () => {
    expect(decideSellerActivation({ role: "customer", applicationStatus: "approved", storeExists: true, storeActive: true }))
      .toEqual({ kind: "activate" });
  });

  it("treats an already active seller click as idempotent", () => {
    expect(decideSellerActivation({ role: "seller", applicationStatus: "approved", storeExists: true, storeActive: true }))
      .toEqual({ kind: "already_active" });
  });

  it("repairs a pending seller-role record only when its active store exists", () => {
    expect(decideSellerActivation({ role: "seller", applicationStatus: "pending", storeExists: true, storeActive: true }))
      .toEqual({ kind: "activate" });
    expect(decideSellerActivation({ role: "seller", applicationStatus: null, storeExists: true, storeActive: true }))
      .toEqual({ kind: "blocked", reason: "missing_application" });
  });

  it("does not bypass a staff rejection or suspension", () => {
    expect(decideSellerActivation({ role: "customer", applicationStatus: "rejected", storeExists: false, storeActive: false }))
      .toEqual({ kind: "blocked", reason: "rejected_application" });
    expect(decideSellerActivation({ role: "customer", applicationStatus: "suspended", storeExists: false, storeActive: false }))
      .toEqual({ kind: "blocked", reason: "suspended_application" });
  });

  it("does not reactivate disabled stores or seller accounts with missing stores", () => {
    expect(decideSellerActivation({ role: "customer", applicationStatus: null, storeExists: true, storeActive: false }))
      .toEqual({ kind: "blocked", reason: "inactive_store" });
    expect(decideSellerActivation({ role: "seller", applicationStatus: "approved", storeExists: false, storeActive: false }))
      .toEqual({ kind: "blocked", reason: "missing_store" });
  });

  it("does not replace staff or administrator roles", () => {
    expect(decideSellerActivation({ role: "staff", applicationStatus: null, storeExists: false, storeActive: false }))
      .toEqual({ kind: "blocked", reason: "privileged_role" });
    expect(decideSellerActivation({ role: "admin", applicationStatus: null, storeExists: false, storeActive: false }))
      .toEqual({ kind: "blocked", reason: "privileged_role" });
  });
});
