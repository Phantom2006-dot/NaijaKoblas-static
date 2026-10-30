import { createHash } from "node:crypto";

export type CheckoutFingerprintInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  deliveryMethod: "standard" | "express";
  items: Array<{ productId: string; size: string; quantity: number }>;
};

export function checkoutFingerprint(input: CheckoutFingerprintInput) {
  const grouped = new Map<string, { productId: string; size: string; quantity: number }>();
  for (const line of input.items) {
    const key = `${line.productId}\u0000${line.size}`;
    const existing = grouped.get(key);
    grouped.set(key, { ...line, quantity: (existing?.quantity ?? 0) + line.quantity });
  }
  const items = [...grouped.values()].sort((left, right) => {
    if (left.productId !== right.productId) return left.productId < right.productId ? -1 : 1;
    if (left.size !== right.size) return left.size < right.size ? -1 : 1;
    return left.quantity - right.quantity;
  });
  const canonical = JSON.stringify({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    address: input.address,
    city: input.city,
    deliveryMethod: input.deliveryMethod,
    items,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
