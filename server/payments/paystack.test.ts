import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializePaystackCheckout, verifyPaystackSignature } from "./paystack";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Paystack webhook signatures", () => {
  const secret = "test-secret-that-is-never-deployed";
  const body = Buffer.from('{"event":"charge.success","data":{"reference":"NKTEST"}}');
  const sign = (payload: Buffer) => createHmac("sha512", secret).update(payload).digest("hex");

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
  it("initializes with the trusted persisted total in kobo and a server-controlled callback", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_never_deployed");
    vi.stubEnv("APP_BASE_URL", "https://shop.example");
    vi.stubEnv("NODE_ENV", "production");
    const request = vi.fn(async () => new Response(JSON.stringify({
      status: true,
      data: {
        authorization_url: "https://checkout.paystack.com/example-session",
        access_code: "example-session",
        reference: "NKREFERENCE123",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", request);

    const result = await initializePaystackCheckout({
      reference: "NKREFERENCE123",
      email: "customer@example.com",
      amountKobo: 5_850_000,
      channels: ["card", "bank_transfer"],
    });

    expect(result).toEqual({
      authorizationUrl: "https://checkout.paystack.com/example-session",
      reference: "NKREFERENCE123",
    });
    const options = request.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(options?.body))).toMatchObject({
      amount: "5850000",
      currency: "NGN",
      reference: "NKREFERENCE123",
      callback_url: "https://shop.example/order-confirmation",
      channels: ["card", "bank_transfer"],
    });
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer sk_test_never_deployed");
  });

  it("rejects a provider-supplied redirect URL outside Paystack hosted checkout", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_never_deployed");
    vi.stubEnv("APP_BASE_URL", "https://shop.example");
    const request = vi.fn(async () => new Response(JSON.stringify({
      status: true,
      data: {
        authorization_url: "https://checkout.attacker.example/session",
        access_code: "example-session",
        reference: "NKREFERENCE123",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    await expect(initializePaystackCheckout({
      reference: "NKREFERENCE123",
      email: "customer@example.com",
      amountKobo: 123_400,
      channels: ["card"],
    })).rejects.toThrow("untrusted checkout URL");
  });

  it("fails without the server secret and makes no provider request", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await expect(initializePaystackCheckout({
      reference: "NKREFERENCE123",
      email: "customer@example.com",
      amountKobo: 123_400,
      channels: ["card"],
    })).rejects.toThrow("not configured");
    expect(request).not.toHaveBeenCalled();
  });
});
