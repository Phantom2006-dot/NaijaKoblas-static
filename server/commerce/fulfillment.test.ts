import { describe, expect, it } from "vitest";
import { canTransitionFulfillment, deriveFulfillmentOrderStatus } from "./fulfillment";

describe("seller fulfillment workflow", () => {
  it("allows only forward state transitions and idempotent repeated updates", () => {
    expect(canTransitionFulfillment("unfulfilled", "processing")).toBe(true);
    expect(canTransitionFulfillment("processing", "shipped")).toBe(true);
    expect(canTransitionFulfillment("shipped", "fulfilled")).toBe(true);
    expect(canTransitionFulfillment("processing", "fulfilled")).toBe(false);
    expect(canTransitionFulfillment("shipped", "processing")).toBe(false);
    expect(canTransitionFulfillment("fulfilled", "shipped")).toBe(false);
    expect(canTransitionFulfillment("shipped", "shipped")).toBe(true);
  });

  it("keeps multi-vendor order state paid, partial, then fulfilled as lines progress", () => {
    expect(deriveFulfillmentOrderStatus(["unfulfilled", "processing"])).toBe("paid");
    expect(deriveFulfillmentOrderStatus(["shipped", "unfulfilled"])).toBe("partially_fulfilled");
    expect(deriveFulfillmentOrderStatus(["fulfilled", "shipped"])).toBe("partially_fulfilled");
    expect(deriveFulfillmentOrderStatus(["fulfilled", "fulfilled"])).toBe("fulfilled");
    expect(() => deriveFulfillmentOrderStatus([])).toThrow("An order must contain at least one fulfillable item.");
  });
});
