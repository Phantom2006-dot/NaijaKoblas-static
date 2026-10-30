import type { PaystackVerification } from "./paystack";

export type PaystackReconciliationOutcome = "success" | "failed" | "pending" | "mismatch";

export function classifyPaystackTransaction(
  transaction: Pick<PaystackVerification, "reference" | "status" | "amount" | "currency">,
  expectedReference: string,
): PaystackReconciliationOutcome {
  if (
    transaction.reference !== expectedReference
    || !Number.isSafeInteger(transaction.amount)
    || transaction.amount < 1
    || transaction.currency !== "NGN"
  ) return "mismatch";
  if (transaction.status === "success") return "success";
  if (["failed", "abandoned", "reversed"].includes(transaction.status)) return "failed";
  return "pending";
}
