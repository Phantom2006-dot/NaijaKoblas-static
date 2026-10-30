import type { DeliveryMethod } from "../../drizzle/schema";

const MAX_DATABASE_INTEGER = 2_147_483_647;
const FREE_STANDARD_SHIPPING_THRESHOLD_KOBO = 5_000_000;
const STANDARD_SHIPPING_KOBO = 250_000;
const EXPRESS_SHIPPING_KOBO = 750_000;

export function calculateCheckoutAmounts(
  lines: Array<{ unitPriceKobo: number; quantity: number }>,
  deliveryMethod: DeliveryMethod,
) {
  if (!lines.length) throw new Error("A checkout needs at least one line item.");
  let subtotalKobo = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.unitPriceKobo) || line.unitPriceKobo < 1) {
      throw new Error("A product price is invalid.");
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw new Error("A product quantity is invalid.");
    }
    const lineTotal = line.unitPriceKobo * line.quantity;
    if (!Number.isSafeInteger(lineTotal) || lineTotal > MAX_DATABASE_INTEGER) {
      throw new Error("The order total is outside the supported range.");
    }
    subtotalKobo += lineTotal;
    if (!Number.isSafeInteger(subtotalKobo) || subtotalKobo > MAX_DATABASE_INTEGER) {
      throw new Error("The order total is outside the supported range.");
    }
  }
  const shippingKobo = deliveryMethod === "express"
    ? EXPRESS_SHIPPING_KOBO
    : subtotalKobo >= FREE_STANDARD_SHIPPING_THRESHOLD_KOBO ? 0 : STANDARD_SHIPPING_KOBO;
  const totalKobo = subtotalKobo + shippingKobo;
  if (totalKobo > MAX_DATABASE_INTEGER) throw new Error("The order total is outside the supported range.");
  return { subtotalKobo, shippingKobo, totalKobo, currency: "NGN" as const };
}
