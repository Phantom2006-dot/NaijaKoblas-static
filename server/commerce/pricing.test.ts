import { describe, expect, it } from "vitest";
import { calculateCheckoutAmounts } from "./pricing";

describe("server checkout pricing", () => {
  it("calculates NGN minor-unit totals and standard shipping server-side", () => {
    expect(calculateCheckoutAmounts([{ unitPriceKobo: 5_850_000, quantity: 1 }], "standard"))
      .toEqual({ subtotalKobo: 5_850_000, shippingKobo: 0, totalKobo: 5_850_000, currency: "NGN" });
    expect(calculateCheckoutAmounts([{ unitPriceKobo: 1_250_000, quantity: 1 }], "standard"))
      .toEqual({ subtotalKobo: 1_250_000, shippingKobo: 250_000, totalKobo: 1_500_000, currency: "NGN" });
  });

  it("uses the express rate regardless of the free-standard threshold", () => {
    expect(calculateCheckoutAmounts([{ unitPriceKobo: 5_850_000, quantity: 1 }], "express"))
      .toMatchObject({ shippingKobo: 750_000, totalKobo: 6_600_000 });
  });

  it("rejects invalid, empty, and database-overflow totals", () => {
    expect(() => calculateCheckoutAmounts([], "standard")).toThrow("at least one");
    expect(() => calculateCheckoutAmounts([{ unitPriceKobo: 0, quantity: 1 }], "standard")).toThrow("price is invalid");
    expect(() => calculateCheckoutAmounts([{ unitPriceKobo: 2_000_000_000, quantity: 2 }], "standard")).toThrow("supported range");
  });
});
