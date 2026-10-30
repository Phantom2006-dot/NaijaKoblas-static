import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializePaystackCheckout, verifyPaystackSignature, verifyPaystackTransaction } from "./paystack";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const secret = "test-secret-that-is-never-deployed";
const body = Buffer.from('{"event":"charge.success","data":{"reference":"NKTEST"}}');
const sign = (payload: Buffer) => createHmac("sha512", secret).update(payload).digest("hex");

const checkoutInput = {
  reference: "NKREFERENCE123",
  orderReference: "NKORDER123",
  email: "customer@example.com",
  amountKobo: 5_850_000,
  channels: ["card", "bank_transfer", "ussd"] as const,
  deliveryMethod: "express" as const,
};

describe("Paystack webhook signatures", () => {
  it("accepts only the signature for the exact raw request body", () => {
    expect(verifyPaystackSignature(body, sign(body), secret)).toBe(true);
    expect(verifyPaystackSignature(body, sign(Buffer.from(`${body.toString()} `)), secret)).toBe(false);
  });

  it("fails closed for absent secrets and malformed signatures", () => {
    expect(verifyPaystackSignature(body, sign(body), "")).toBe(false);
    expect(verifyPaystackSignature(body, undefined, secret)).toBe(false);
    expect(verifyPaystackSignature(body, "not-a-signature", secret)).toBe(false);
  });
});

describe("Paystack hosted checkout", () => {
  it("initializes from trusted NGN/kobo totals and server-controlled callback/metadata", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_never_deployed");
    vi.stubEnv("APP_BASE_URL", "https://shop.example/path");
    vi.stubEnv("NODE_ENV", "production");
    const request = vi.fn(async () => new Response(JSON.stringify({
      status: true,
      data: {
        authorization_url: "https://checkout.paystack.com/example-session",
        access_code: "example-session",
        reference: checkoutInput.reference,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", request);

    const result = await initializePaystackCheckout(checkoutInput);
    expect(result).toEqual({ authorizationUrl: "https://checkout.paystack.com/example-session", reference: checkoutInput.reference });
    const options = request.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(options?.body))).toMatchObject({
      amount: "5850000",
      currency: "NGN",
      reference: checkoutInput.reference,
      callback_url: "https://shop.example/order-confirmation",
      channels: ["card", "bank_transfer", "ussd"],
      metadata: {
        order_reference: checkoutInput.orderReference,
        payment_reference: checkoutInput.reference,
        cancel_action: "https://shop.example/checkout?delivery=express&cancelled=true",
      },
    });
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer sk_test_never_deployed");
  });

  it("rejects any provider redirect outside Paystack hosted checkout", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_never_deployed");
    vi.stubEnv("APP_BASE_URL", "https://shop.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: true,
      data: { authorization_url: "https://checkout.attacker.example/session", reference: checkoutInput.reference },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(initializePaystackCheckout(checkoutInput)).rejects.toThrow("untrusted checkout URL");
  });

  it("fails without the server secret and makes no provider request", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(initializePaystackCheckout(checkoutInput)).rejects.toThrow("PAYSTACK_SECRET_KEY is not configured");
    expect(request).not.toHaveBeenCalled();
  });

  it("verifies a transaction using the secret server-side", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_never_deployed");
    const request = vi.fn(async () => new Response(JSON.stringify({
      status: true,
      data: { id: 123, status: "success", reference: checkoutInput.reference, amount: 5_850_000, currency: "NGN" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    const transaction = await verifyPaystackTransaction(checkoutInput.reference);
    expect(transaction).toMatchObject({ status: "success", reference: checkoutInput.reference, amount: 5_850_000, currency: "NGN" });
    expect(String(request.mock.calls[0]?.[0])).toContain(`/transaction/verify/${checkoutInput.reference}`);
  });
});
