import { describe, expect, it } from "vitest";
import { checkoutFingerprint, type CheckoutFingerprintInput } from "./idempotency";

const input: CheckoutFingerprintInput = {
  firstName: "Ada",
  lastName: "Okafor",
  email: "ada@example.com",
  phone: "+2348000000000",
  address: "1 Market Road",
  city: "Lagos",
  deliveryMethod: "standard",
  items: [
    { productId: "prod_a", size: "M", quantity: 1 },
    { productId: "prod_b", size: "One size", quantity: 2 },
  ],
};

describe("checkout idempotency fingerprint", () => {
  it("is stable when semantically identical line items are reordered or split", () => {
    const reordered = {
      ...input,
      items: [
        { productId: "prod_b", size: "One size", quantity: 1 },
        { productId: "prod_a", size: "M", quantity: 1 },
        { productId: "prod_b", size: "One size", quantity: 1 },
      ],
    };
    expect(checkoutFingerprint(reordered)).toBe(checkoutFingerprint(input));
  });

  it("changes when shipping identity, delivery method or item quantity changes", () => {
    expect(checkoutFingerprint({ ...input, address: "2 Market Road" })).not.toBe(checkoutFingerprint(input));
    expect(checkoutFingerprint({ ...input, deliveryMethod: "express" })).not.toBe(checkoutFingerprint(input));
    expect(checkoutFingerprint({ ...input, items: input.items.map((line, index) => index ? line : { ...line, quantity: 2 }) }))
      .not.toBe(checkoutFingerprint(input));
  });
});
