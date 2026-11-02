import type { AccountRole, SellerApplicationStatus } from "../../drizzle/schema";

export type SellerActivationBlockReason =
  | "privileged_role"
  | "rejected_application"
  | "suspended_application"
  | "inactive_store"
  | "missing_store"
  | "missing_application";

export type SellerActivationPlan =
  | { kind: "activate" }
  | { kind: "already_active" }
  | { kind: "blocked"; reason: SellerActivationBlockReason };

export function decideSellerActivation(input: {
  role: AccountRole;
  applicationStatus: SellerApplicationStatus | null;
  storeExists: boolean;
  storeActive: boolean;
}): SellerActivationPlan {
  if (input.role === "staff" || input.role === "admin") {
    return { kind: "blocked", reason: "privileged_role" };
  }
  if (input.applicationStatus === "rejected") {
    return { kind: "blocked", reason: "rejected_application" };
  }
  if (input.applicationStatus === "suspended") {
    return { kind: "blocked", reason: "suspended_application" };
  }
  if (input.storeExists && !input.storeActive) {
    return { kind: "blocked", reason: "inactive_store" };
  }
  if (input.role === "seller") {
    if (!input.storeExists) return { kind: "blocked", reason: "missing_store" };
    if (input.applicationStatus === "pending") return { kind: "activate" };
    if (input.applicationStatus !== "approved") return { kind: "blocked", reason: "missing_application" };
    return { kind: "already_active" };
  }
  if (input.role !== "customer") {
    return { kind: "blocked", reason: "privileged_role" };
  }
  return { kind: "activate" };
}
