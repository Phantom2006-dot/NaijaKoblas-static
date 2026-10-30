import type { Express, Request } from "express";
import * as db from "../db";
import { verifyPaystackSignature } from "./paystack";

type PaystackWebhook = {
  event?: unknown;
  data?: {
    reference?: unknown;
    amount?: unknown;
    currency?: unknown;
    status?: unknown;
    id?: unknown;
    metadata?: unknown;
  };
};

function readMetadata(value: unknown) {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  return candidate as Record<string, unknown>;
}

export function registerPaymentRoutes(app: Express) {
  app.post("/api/payments/paystack/webhook", async (req: Request, res) => {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody || !verifyPaystackSignature(rawBody, req.get("x-paystack-signature"))) {
      res.status(401).json({ error: "Invalid payment webhook signature." });
      return;
    }

    const event = req.body as PaystackWebhook;
    if (event.event !== "charge.success") {
      res.status(200).json({ received: true });
      return;
    }
    const data = event.data;
    if (
      !data
      || typeof data.reference !== "string"
      || !Number.isSafeInteger(data.amount)
      || typeof data.currency !== "string"
      || data.status !== "success"
      || (typeof data.id !== "string" && typeof data.id !== "number")
    ) {
      res.status(400).json({ error: "Invalid payment event." });
      return;
    }

    try {
      const record = await db.getPaymentByReference(data.reference);
      if (!record) {
        // Unknown references are acknowledged so an authentic event cannot be retried forever.
        res.status(200).json({ received: true });
        return;
      }
      const metadata = readMetadata(data.metadata);
      if (metadata && (
        (metadata.order_reference !== undefined && metadata.order_reference !== record.order.reference)
        || (metadata.payment_reference !== undefined && metadata.payment_reference !== record.payment.reference)
      )) {
        // The signed, unique transaction reference plus stored amount/currency are authoritative.
        // Metadata is useful for diagnostics but provider serialization/omission must not drop a real payment.
        console.warn("[Paystack] Payment metadata differed from the stored order; validating by reference and amount:", data.reference);
      }

      const result = await db.markPaymentSucceeded({
        reference: data.reference,
        amountKobo: data.amount as number,
        currency: data.currency,
        providerTransactionId: String(data.id),
      });
      if (!result.success && result.reason !== "not_found") {
        // An authentic event with a mismatched amount or non-pending record
        // is logged for reconciliation and is never applied as a payment.
        console.warn("[Paystack] Ignored an authentic event not matching a pending order:", result.reason, data.reference);
      }
      res.status(200).json({ received: true });
    } catch (error) {
      console.error("[Paystack] Webhook processing failed:", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "Payment event could not be processed." });
    }
  });
}
