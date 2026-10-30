import { createHmac, timingSafeEqual } from "node:crypto";
import { ENV } from "../_core/env";

export type PaystackChannel = "card" | "bank_transfer" | "ussd";

type PaystackEnvelope<T> = { status: boolean; message?: string; data?: T };

type PaystackInitialization = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

type PaystackVerification = {
  id: number | string;
  status: string;
  reference: string;
  amount: number;
  currency: string;
};

function requiredSecret() {
  if (!ENV.paystackSecretKey) throw new Error("Paystack is not configured.");
  return ENV.paystackSecretKey;
}

function callbackUrl() {
  if (!ENV.appBaseUrl) throw new Error("APP_BASE_URL is not configured.");
  let base: URL;
  try {
    base = new URL(ENV.appBaseUrl);
  } catch {
    throw new Error("APP_BASE_URL must be a valid absolute URL.");
  }
  if (base.protocol !== "https:" && !(ENV.isProduction === false && base.protocol === "http:")) {
    throw new Error("APP_BASE_URL must use HTTPS in production.");
  }
  return new URL("/order-confirmation", base).toString();
}

function checkoutUrl(value: string | undefined) {
  if (!value) throw new Error("Payment provider did not return a checkout URL.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Payment provider returned an invalid checkout URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "checkout.paystack.com") {
    throw new Error("Payment provider returned an untrusted checkout URL.");
  }
  return url.toString();
}

export async function initializePaystackCheckout(input: {
  reference: string;
  email: string;
  amountKobo: number;
  channels: PaystackChannel[];
}) {
  const secret = requiredSecret();
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      amount: String(input.amountKobo),
      currency: "NGN",
      reference: input.reference,
      callback_url: callbackUrl(),
      channels: input.channels,
      metadata: { order_reference: input.reference },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Payment provider could not start checkout.");
  const payload = await response.json() as PaystackEnvelope<PaystackInitialization>;
  if (!payload.status || !payload.data || payload.data.reference !== input.reference) {
    throw new Error("Payment provider did not confirm the checkout request.");
  }
  return {
    authorizationUrl: checkoutUrl(payload.data.authorization_url),
    reference: payload.data.reference,
  };
}

export async function verifyPaystackTransaction(reference: string) {
  const secret = requiredSecret();
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Payment provider could not verify this transaction.");
  const payload = await response.json() as PaystackEnvelope<PaystackVerification>;
  if (!payload.status || !payload.data) throw new Error("Payment provider returned no transaction status.");
  return payload.data;
}

export function verifyPaystackSignature(rawBody: Buffer, signature: string | undefined, secret = ENV.paystackSecretKey) {
  if (!secret || !signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
