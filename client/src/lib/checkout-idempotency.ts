type CheckoutFingerprintPayload = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  deliveryMethod: "standard" | "express";
  items: Array<{ productId: string; size: string; quantity: number }>;
};

const prefix = "naijakoblas:checkout-retry:";

export async function getCheckoutIdempotencyKey(payload: CheckoutFingerprintPayload) {
  const canonical = JSON.stringify({
    ...payload,
    items: [...payload.items].sort((left, right) => {
      if (left.productId !== right.productId) return left.productId < right.productId ? -1 : 1;
      if (left.size !== right.size) return left.size < right.size ? -1 : 1;
      return left.quantity - right.quantity;
    }),
  });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const fingerprint = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  const storageKey = `${prefix}${fingerprint}`;
  try {
    const current = sessionStorage.getItem(storageKey);
    if (current) return current;
    const next = globalThis.crypto.randomUUID();
    sessionStorage.setItem(storageKey, next);
    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(prefix)));
    while (keys.length > 20) {
      const oldest = keys.shift();
      if (oldest) sessionStorage.removeItem(oldest);
    }
    return next;
  } catch {
    return globalThis.crypto.randomUUID();
  }
}

export function clearCheckoutIdempotencyKeys() {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(prefix)));
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // sessionStorage may be unavailable in private or embedded browser contexts.
  }
}
