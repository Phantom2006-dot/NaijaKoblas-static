export const fulfillmentStatuses = ["unfulfilled", "processing", "shipped", "fulfilled"] as const;
export type FulfillmentStatus = (typeof fulfillmentStatuses)[number];
export type FulfillmentOrderStatus = "paid" | "partially_fulfilled" | "fulfilled";

const allowedTransitions: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
  unfulfilled: ["processing"],
  processing: ["shipped"],
  shipped: ["fulfilled"],
  fulfilled: [],
};

export function canTransitionFulfillment(current: FulfillmentStatus, next: FulfillmentStatus) {
  return current === next || allowedTransitions[current].includes(next);
}

export function deriveFulfillmentOrderStatus(statuses: readonly FulfillmentStatus[]): FulfillmentOrderStatus {
  if (statuses.length === 0) throw new Error("An order must contain at least one fulfillable item.");
  if (statuses.every(status => status === "fulfilled")) return "fulfilled";
  if (statuses.some(status => status === "shipped" || status === "fulfilled")) return "partially_fulfilled";
  return "paid";
}
