import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { canTransitionFulfillment, deriveFulfillmentOrderStatus } from "../commerce/fulfillment";
import {
  adminOperationsRouter,
  getAdminProviderSettings,
  sumSafeVerifiedKobo,
} from "./operations";

vi.mock("../db", () => ({ getDb: vi.fn(async () => undefined) }));

function context(role: "customer" | "seller" | "staff" | "admin" | null): TrpcContext {
  return {
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: role ? {
      id: 1,
      openId: `operations-${role}`,
      name: role,
      email: `${role}@example.invalid`,
      loginMethod: "test",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } : null,
  };
}

async function expectCode(action: Promise<unknown>, code: string) {
  await expect(action).rejects.toMatchObject({ code });
}

describe("admin operations helpers", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("counts only consistent, non-negative safe verified kobo amounts", () => {
    expect(sumSafeVerifiedKobo([
      { amountKobo: 10_000, orderTotalKobo: 10_000, currency: "NGN", orderCurrency: "NGN" },
      { amountKobo: 20_000, orderTotalKobo: 19_000, currency: "NGN", orderCurrency: "NGN" },
      { amountKobo: 30_000, orderTotalKobo: 30_000, currency: "USD", orderCurrency: "NGN" },
      { amountKobo: -1, orderTotalKobo: -1, currency: "NGN", orderCurrency: "NGN" },
      { amountKobo: Number.MAX_SAFE_INTEGER, orderTotalKobo: Number.MAX_SAFE_INTEGER, currency: "NGN", orderCurrency: "NGN" },
      { amountKobo: 2, orderTotalKobo: 2, currency: "NGN", orderCurrency: "NGN" },
    ])).toBe(10_002);
  });

  it("returns settings booleans and supported operations without exposing credentials", () => {
    process.env.PAYSTACK_SECRET_KEY = "paystack-test-secret";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.CLOUDINARY_CLOUD_NAME = "cloud-name";
    process.env.CLOUDINARY_API_KEY = "cloud-key";
    process.env.CLOUDINARY_API_SECRET = "cloud-secret";
    const result = getAdminProviderSettings();
    const encoded = JSON.stringify(result);
    expect(result.providers.paystack.configured).toBe(true);
    expect(result.providers.cloudinary.configured).toBe(true);
    expect(result.providers.paystack.supportedOperations).toContain("verify_payment");
    expect(result.providers.cloudinary.supportedOperations).toContain("product_image_upload");
    expect(encoded).not.toContain("paystack-test-secret");
    expect(encoded).not.toContain("cloud-secret");
    expect(encoded).not.toContain("cloud-key");
  });

  it("keeps provider readiness false when only partial credentials are configured", () => {
    process.env.PAYSTACK_SECRET_KEY = "paystack-test-secret";
    process.env.APP_BASE_URL = "";
    process.env.CLOUDINARY_CLOUD_NAME = "cloud-name";
    process.env.CLOUDINARY_API_KEY = "";
    process.env.CLOUDINARY_API_SECRET = "cloud-secret";
    const result = getAdminProviderSettings();
    expect(result.providers.paystack.configured).toBe(false);
    expect(result.providers.cloudinary.configured).toBe(false);
  });

  it("exposes the operations surface needed by the composed admin router", () => {
    const record = adminOperationsRouter._def.record;
    expect(record).toHaveProperty("overview");
    expect(record).toHaveProperty("categories");
    expect(record).toHaveProperty("orders");
    expect(record).toHaveProperty("customers");
    expect(record).toHaveProperty("providers");
    expect(record).toHaveProperty("settings");
    expect(record).toHaveProperty("updateOrderItemFulfillment");
  });
});

describe("admin fulfillment state semantics", () => {
  it("permits only the existing forward item state machine", () => {
    expect(canTransitionFulfillment("unfulfilled", "processing")).toBe(true);
    expect(canTransitionFulfillment("processing", "shipped")).toBe(true);
    expect(canTransitionFulfillment("shipped", "fulfilled")).toBe(true);
    expect(canTransitionFulfillment("unfulfilled", "shipped")).toBe(false);
    expect(canTransitionFulfillment("fulfilled", "processing")).toBe(false);
  });

  it("derives order state from all item states", () => {
    expect(deriveFulfillmentOrderStatus(["unfulfilled", "processing"])).toBe("paid");
    expect(deriveFulfillmentOrderStatus(["shipped", "processing"])).toBe("partially_fulfilled");
    expect(deriveFulfillmentOrderStatus(["fulfilled", "fulfilled"])).toBe("fulfilled");
    expect(() => deriveFulfillmentOrderStatus([])).toThrow("at least one");
  });
});

describe("admin operations authorization", () => {
  it("rejects anonymous, customer, seller, and staff reads before database access", async () => {
    for (const role of [null, "customer", "seller", "staff"] as const) {
      const caller = adminOperationsRouter.createCaller(context(role));
      await expectCode(caller.overview(), role ? "FORBIDDEN" : "UNAUTHORIZED");
    }
  });

  it("allows an admin through the gate and reports a clear database precondition", async () => {
    const caller = adminOperationsRouter.createCaller(context("admin"));
    await expectCode(caller.overview(), "PRECONDITION_FAILED");
  });
});
