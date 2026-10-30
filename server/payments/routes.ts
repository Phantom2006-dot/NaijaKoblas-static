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
  };
};

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
      !data ||
      typeof data.reference !== "string" ||
      !Number.isSafeInteger(data.amount) ||
      typeof data.currency !== "string" ||
      data.status !== "success"
    ) {
      res.status(400).json({ error: "Invalid payment event." });
      return;
    }

    try {
      const result = await db.markPaymentSucceeded({
        reference: data.reference,
        amountKobo: data.amount as number,
        currency: data.currency,
        providerTransactionId: data.id === undefined ? undefined : String(data.id),
      });
      if (result.success || result.reason === "not_found") {
        res.status(200).json({ received: true });
        return;
      }
      // Signature is authentic, but a mismatched amount or non-pending payment
      // must never mark the order paid. Acknowledge to avoid useless retries.
      console.warn("[Payments] Ignored an authentic webhook that did not match a pending order:", result.reason);
      res.status(200).json({ received: true });
    } catch (error) {
      console.error("[Payments] Webhook processing failed:", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "Payment event could not be processed." });
    }
  });
}
