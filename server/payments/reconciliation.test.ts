import { describe, expect, it } from "vitest";
import { classifyPaystackTransaction } from "./reconciliation";

const transaction = {
  reference: "NKREFERENCE123",
  status: "success",
  amount: 520_000,
  currency: "NGN",
};

describe("Paystack reconciliation classification", () => {
  it("accepts a matching successful NGN transaction", () => {
    expect(classifyPaystackTransaction(transaction, transaction.reference)).toBe("success");
  });

  it.each(["failed", "abandoned", "reversed"]) ("marks provider status %s as terminal failure", status => {
    expect(classifyPaystackTransaction({ ...transaction, status }, transaction.reference)).toBe("failed");
  });

  it.each(["pending", "ongoing", "processing", "queued"]) ("keeps non-terminal/unsupported status %s pending", status => {
    expect(classifyPaystackTransaction({ ...transaction, status }, transaction.reference)).toBe("pending");
  });

  it("fails closed when reference, amount or currency do not match", () => {
    expect(classifyPaystackTransaction({ ...transaction, reference: "OTHER" }, transaction.reference)).toBe("mismatch");
    expect(classifyPaystackTransaction({ ...transaction, amount: Number.NaN }, transaction.reference)).toBe("mismatch");
    expect(classifyPaystackTransaction({ ...transaction, currency: "USD" }, transaction.reference)).toBe("mismatch");
  });
});
