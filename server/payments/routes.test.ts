import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "../db";
import { registerPaymentRoutes } from "./routes";

vi.mock("../db", () => ({
  getPaymentByReference: vi.fn(),
  markPaymentSucceeded: vi.fn(),
  markPaymentFailed: vi.fn(),
}));

const secret = "paystack_route_test_secret";
let server: Server | undefined;

function signed(payload: string) {
  return createHmac("sha512", secret).update(payload).digest("hex");
}

async function postRaw(body: string, signature: string) {
  const app = express();
  app.use(express.json({
    verify(req, _res, buffer) {
      if (req.url?.startsWith("/api/payments/paystack/webhook")) {
        (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      }
    },
  }));
  registerPaymentRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server!.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${port}/api/payments/paystack/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": signature },
    body,
  });
}

function paymentEvent(metadata: unknown = { order_reference: "NKORDER123", payment_reference: "NKPAYMENT123" }, includeMetadata = true) {
  return {
    event: "charge.success",
    data: {
      id: 887766,
      status: "success",
      reference: "NKPAYMENT123",
      amount: 520_000,
      currency: "NGN",
      ...(includeMetadata ? { metadata } : {}),
    },
  };
}

const storedPayment = {
  payment: { reference: "NKPAYMENT123", status: "pending" },
  order: { reference: "NKORDER123", status: "pending_payment", totalKobo: 520_000 },
};

afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("Paystack webhook route", () => {
  it("verifies the exact raw body and marks only the matching NGN payment successful", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", secret);
    vi.mocked(db.getPaymentByReference).mockResolvedValue(storedPayment as never);
    vi.mocked(db.markPaymentSucceeded).mockResolvedValue({ success: true, alreadyProcessed: false });
    const body = JSON.stringify(paymentEvent());

    const response = await postRaw(body, signed(body));
    expect(response.status).toBe(200);
    expect(db.getPaymentByReference).toHaveBeenCalledWith("NKPAYMENT123");
    expect(db.markPaymentSucceeded).toHaveBeenCalledWith({
      reference: "NKPAYMENT123",
      amountKobo: 520_000,
      currency: "NGN",
      providerTransactionId: "887766",
    });
  });

  it("does not drop an authentic matching payment when optional metadata differs", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", secret);
    vi.mocked(db.getPaymentByReference).mockResolvedValue(storedPayment as never);
    vi.mocked(db.markPaymentSucceeded).mockResolvedValue({ success: true, alreadyProcessed: false });
    const body = JSON.stringify(paymentEvent({ order_reference: "OTHERORDER", payment_reference: "NKPAYMENT123" }));

    const response = await postRaw(body, signed(body));
    expect(response.status).toBe(200);
    expect(db.markPaymentSucceeded).toHaveBeenCalledWith(expect.objectContaining({ reference: "NKPAYMENT123", amountKobo: 520_000, currency: "NGN" }));
  });

  it.each([
    ["stringified JSON", JSON.stringify({ order_reference: "NKORDER123", payment_reference: "NKPAYMENT123" }), true],
    ["omitted", undefined, false],
  ])("accepts valid success with %s metadata encoding", async (_label, metadata, includeMetadata) => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", secret);
    vi.mocked(db.getPaymentByReference).mockResolvedValue(storedPayment as never);
    vi.mocked(db.markPaymentSucceeded).mockResolvedValue({ success: true, alreadyProcessed: false });
    const body = JSON.stringify(paymentEvent(metadata, includeMetadata));

    const response = await postRaw(body, signed(body));
    expect(response.status).toBe(200);
    expect(db.markPaymentSucceeded).toHaveBeenCalledWith(expect.objectContaining({ reference: "NKPAYMENT123", amountKobo: 520_000, currency: "NGN" }));
  });

  it("rejects a tampered raw body without querying payment state", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", secret);
    const eventBody = JSON.stringify(paymentEvent());
    const response = await postRaw(`${eventBody} `, signed(eventBody));

    expect(response.status).toBe(401);
    expect(db.getPaymentByReference).not.toHaveBeenCalled();
    expect(db.markPaymentSucceeded).not.toHaveBeenCalled();
  });

  it("acknowledges unrelated signed event types without changing order state", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", secret);
    const body = JSON.stringify({ event: "transfer.success", data: {} });
    const response = await postRaw(body, signed(body));
    expect(response.status).toBe(200);
    expect(db.getPaymentByReference).not.toHaveBeenCalled();
  });
});
