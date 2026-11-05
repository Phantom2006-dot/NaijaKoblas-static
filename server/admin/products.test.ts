import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { adminProductManagementRouter, adminProductListInput, adminProductUpdateInput } from "./products";

vi.mock("../db", () => ({ getDb: vi.fn(async () => undefined) }));

const context = (role: "customer" | "seller" | "staff" | "admin" | null): TrpcContext => ({
  req: {} as TrpcContext["req"],
  res: {} as TrpcContext["res"],
  user: role ? {
    id: 1,
    openId: `test-${role}`,
    name: role,
    email: `${role}@example.invalid`,
    loginMethod: "test",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  } : null,
});

async function expectCode(action: Promise<unknown>, code: string) {
  await expect(action).rejects.toMatchObject({ code });
}

describe("admin product-management router", () => {
  it("rejects anonymous, customer, seller, and staff reads before touching the database", async () => {
    for (const role of [null, "customer", "seller", "staff"] as const) {
      const caller = adminProductManagementRouter.createCaller(context(role));
      await expectCode(caller.list({}), role ? "FORBIDDEN" : "UNAUTHORIZED");
    }
  });

  it("rejects non-admin writes, including seller-draft creation", async () => {
    const input = {
      sellerUserId: 10,
      product: {
        name: "Hand-finished belt",
        description: "A durable hand-finished leather belt for everyday wear.",
        category: "Belts",
        priceNaira: 12500,
        sizes: ["M"],
        inventoryCount: 4,
      },
    };
    for (const role of [null, "customer", "seller", "staff"] as const) {
      const caller = adminProductManagementRouter.createCaller(context(role));
      await expectCode(caller.create(input), role ? "FORBIDDEN" : "UNAUTHORIZED");
    }
  });

  it("uses strict bounded list and update input contracts", async () => {
    expect(adminProductListInput.safeParse({ limit: 101 }).success).toBe(false);
    expect(adminProductListInput.safeParse({ offset: -1 }).success).toBe(false);
    expect(adminProductListInput.safeParse({ stock: "reserved" }).success).toBe(false);
    expect(adminProductListInput.safeParse({ unexpected: true }).success).toBe(false);
    expect(adminProductUpdateInput.safeParse({
      productId: "prod_test",
      expectedUpdatedAt: new Date(),
      changes: { priceNaira: 12.34 },
    }).success).toBe(true);
    expect(adminProductUpdateInput.safeParse({
      productId: "prod_test",
      expectedUpdatedAt: new Date(),
      changes: { priceNaira: 12.345 },
    }).success).toBe(false);
    expect(adminProductUpdateInput.safeParse({
      productId: "prod_test",
      expectedUpdatedAt: new Date(),
      changes: { priceNaira: Number.MAX_SAFE_INTEGER },
    }).success).toBe(false);
    expect(adminProductUpdateInput.safeParse({
      productId: "prod_test",
      expectedUpdatedAt: new Date(),
      changes: { madeUpField: "nope" },
    }).success).toBe(false);
  });

  it("keeps the admin gate on valid calls when no database is configured", async () => {
    const caller = adminProductManagementRouter.createCaller(context("admin"));
    await expectCode(caller.list({}), "PRECONDITION_FAILED");
    await expectCode(caller.categories(), "PRECONDITION_FAILED");
  });
});
