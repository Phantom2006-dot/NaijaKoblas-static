import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  accountAuditEvents,
  customerProfiles,
  orderItems,
  orders,
  orderItemStatuses,
  paymentTransactions,
  productStatuses,
  sellerProducts,
  users,
  orderStatuses,
  paymentStatuses,
} from "../../drizzle/schema";
import { canTransitionFulfillment, deriveFulfillmentOrderStatus, fulfillmentStatuses, type FulfillmentStatus } from "../commerce/fulfillment";
import { getDb } from "../db";
import { ENV } from "../_core/env";
import { adminProcedure, router } from "../_core/trpc";

const LOW_STOCK_THRESHOLD = 5;
const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 100_000;
const MAX_CUSTOMER_ORDER_HISTORY = 100;
const PAID_ORDER_STATUSES = ["paid", "partially_fulfilled", "fulfilled"] as const;

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type SqlCondition = ReturnType<typeof eq>;

function requireDatabase(database: Awaited<ReturnType<typeof getDb>>): Database {
  if (!database) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The database is not available." });
  return database;
}

function whereAll(conditions: SqlCondition[]) {
  return conditions.length ? and(...conditions) : undefined;
}

function boundedPage(input: { offset?: number; limit?: number }) {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 25;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Offset must be a non-negative integer." });
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new TRPCError({ code: "BAD_REQUEST", message: `Limit must be between 1 and ${MAX_PAGE_SIZE}.` });
  return { offset, limit };
}

function countValue(row: { value?: number | string | bigint } | undefined) {
  return Number(row?.value ?? 0);
}

/** Sums only internally consistent, non-negative safe integer amounts. */
export function sumSafeVerifiedKobo(rows: Array<{
  amountKobo: number;
  orderTotalKobo: number;
  currency: string;
  orderCurrency: string;
}>) {
  let total = 0;
  for (const row of rows) {
    if (
      row.currency !== "NGN" || row.orderCurrency !== "NGN"
      || !Number.isSafeInteger(row.amountKobo) || row.amountKobo < 0
      || !Number.isSafeInteger(row.orderTotalKobo) || row.orderTotalKobo < 0
      || row.amountKobo !== row.orderTotalKobo
      || row.amountKobo > Number.MAX_SAFE_INTEGER - total
    ) continue;
    total += row.amountKobo;
  }
  return total;
}

function lagosDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dayStartUtcForLagosDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(`${fields.year}-${fields.month}-${fields.day}T00:00:00+01:00`);
}

async function verifiedRevenueRows(database: Database, since?: Date) {
  const conditions = [
    eq(paymentTransactions.status, "succeeded"),
    inArray(orders.status, [...PAID_ORDER_STATUSES]),
    isNotNull(paymentTransactions.verifiedAt),
  ];
  if (since) conditions.push(gte(paymentTransactions.verifiedAt, since));
  return database.select({
    amountKobo: paymentTransactions.amountKobo,
    orderTotalKobo: orders.totalKobo,
    currency: paymentTransactions.currency,
    orderCurrency: orders.currency,
    verifiedAt: paymentTransactions.verifiedAt,
    orderId: orders.id,
  }).from(paymentTransactions)
    .innerJoin(orders, eq(orders.id, paymentTransactions.orderId))
    .where(and(...conditions));
}

async function getSalesLast30Days(database: Database) {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const rows = await verifiedRevenueRows(database, since);
  const byDay = new Map<string, { revenueKobo: number; orderIds: Set<number> }>();
  for (const row of rows) {
    if (!row.verifiedAt) continue;
    const valid = sumSafeVerifiedKobo([row]);
    if (valid === 0 && row.amountKobo !== 0) continue;
    const date = lagosDate(row.verifiedAt);
    const current = byDay.get(date) ?? { revenueKobo: 0, orderIds: new Set<number>() };
    if (valid <= Number.MAX_SAFE_INTEGER - current.revenueKobo) {
      current.revenueKobo += valid;
      current.orderIds.add(row.orderId);
    }
    byDay.set(date, current);
  }
  const lastDate = dayStartUtcForLagosDate(now);
  const items = Array.from({ length: 30 }, (_, index) => {
    const date = lagosDate(addDays(lastDate, index - 29));
    const current = byDay.get(date);
    return { date, revenueKobo: current?.revenueKobo ?? 0, orderCount: current?.orderIds.size ?? 0 };
  });
  return items;
}

export async function getAdminOverview() {
  const database = requireDatabase(await getDb());
  const [
    products,
    ordersCount,
    pendingOrders,
    completedOrders,
    lowStockProducts,
    customers,
    revenueRows,
    recentProducts,
    recentOrders,
    salesLast30Days,
  ] = await Promise.all([
    database.select({ value: count() }).from(sellerProducts),
    database.select({ value: count() }).from(orders),
    database.select({ value: count() }).from(orders).where(eq(orders.status, "pending_payment")),
    database.select({ value: count() }).from(orders).where(eq(orders.status, "fulfilled")),
    database.select({ value: count() }).from(sellerProducts).where(lte(sellerProducts.inventoryCount, LOW_STOCK_THRESHOLD)),
    database.select({ value: count() }).from(users).where(eq(users.role, "customer")),
    verifiedRevenueRows(database),
    database.select({
      id: sellerProducts.id,
      name: sellerProducts.name,
      category: sellerProducts.category,
      priceKobo: sellerProducts.priceKobo,
      inventoryCount: sellerProducts.inventoryCount,
      status: sellerProducts.status,
      createdAt: sellerProducts.createdAt,
    }).from(sellerProducts).orderBy(desc(sellerProducts.createdAt), desc(sellerProducts.id)).limit(5),
    database.select({
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
      totalKobo: orders.totalKobo,
      currency: orders.currency,
      customerName: sql<string>`concat_ws(' ', ${orders.firstName}, ${orders.lastName})`,
      customerEmail: orders.email,
      paymentStatus: paymentTransactions.status,
      createdAt: orders.createdAt,
    }).from(orders).innerJoin(paymentTransactions, eq(paymentTransactions.orderId, orders.id))
      .orderBy(desc(orders.createdAt), desc(orders.id)).limit(5),
    getSalesLast30Days(database),
  ]);
  return {
    totalProducts: countValue(products[0]),
    totalOrders: countValue(ordersCount[0]),
    pendingOrders: countValue(pendingOrders[0]),
    completedOrders: countValue(completedOrders[0]),
    lowStockProducts: countValue(lowStockProducts[0]),
    totalCustomers: countValue(customers[0]),
    revenueKobo: sumSafeVerifiedKobo(revenueRows),
    recentProducts,
    recentOrders,
    salesLast30Days,
  };
}

export async function getAdminCategories() {
  const database = requireDatabase(await getDb());
  const items = await database.select({
    category: sellerProducts.category,
    productCount: count(sellerProducts.id),
  }).from(sellerProducts).groupBy(sellerProducts.category).orderBy(asc(sellerProducts.category));
  return items.map(item => ({ category: item.category, productCount: Number(item.productCount) }));
}

export const adminOrderListInput = z.object({
  search: z.string().trim().max(160).optional(),
  status: z.enum(orderStatuses).optional(),
  paymentStatus: z.enum(paymentStatuses).optional(),
  offset: z.number().int().min(0).max(MAX_OFFSET).default(0),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
}).strict();
export const adminOrderDetailInput = z.object({ reference: z.string().trim().min(1).max(64) }).strict();
export type AdminOrderListInput = z.input<typeof adminOrderListInput>;

function orderConditions(input: z.output<typeof adminOrderListInput>) {
  const conditions: SqlCondition[] = [];
  if (input.status) conditions.push(eq(orders.status, input.status));
  if (input.paymentStatus) conditions.push(eq(paymentTransactions.status, input.paymentStatus));
  const search = input.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(
      ilike(orders.reference, pattern),
      ilike(orders.email, pattern),
      ilike(orders.firstName, pattern),
      ilike(orders.lastName, pattern),
      ilike(users.name, pattern),
      ilike(users.email, pattern),
    )!);
  }
  return conditions;
}

export async function listAdminOrders(input: AdminOrderListInput = {}) {
  const normalized = adminOrderListInput.parse(input);
  const database = requireDatabase(await getDb());
  const { offset, limit } = boundedPage(normalized);
  const conditions = orderConditions(normalized);
  const where = whereAll(conditions);
  const [rows, totals] = await Promise.all([
    database.select({
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
      totalKobo: orders.totalKobo,
      currency: orders.currency,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      paymentStatus: paymentTransactions.status,
      paymentVerifiedAt: paymentTransactions.verifiedAt,
      customer: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
    }).from(orders)
      .innerJoin(paymentTransactions, eq(paymentTransactions.orderId, orders.id))
      .innerJoin(users, eq(users.id, orders.customerUserId))
      .where(where).orderBy(desc(orders.createdAt), desc(orders.id)).offset(offset).limit(limit),
    database.select({ value: count() }).from(orders)
      .innerJoin(paymentTransactions, eq(paymentTransactions.orderId, orders.id))
      .innerJoin(users, eq(users.id, orders.customerUserId)).where(where),
  ]);
  const total = countValue(totals[0]);
  return { items: rows, total, offset, limit, hasMore: offset + rows.length < total };
}

export async function getAdminOrderDetail(reference: string) {
  const database = requireDatabase(await getDb());
  const rows = await database.select({
    order: orders,
    payment: {
      status: paymentTransactions.status,
      amountKobo: paymentTransactions.amountKobo,
      currency: paymentTransactions.currency,
      verifiedAt: paymentTransactions.verifiedAt,
    },
    customerUser: {
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    },
  }).from(orders)
    .innerJoin(paymentTransactions, eq(paymentTransactions.orderId, orders.id))
    .innerJoin(users, eq(users.id, orders.customerUserId))
    .where(eq(orders.reference, reference)).limit(1);
  const row = rows[0];
  if (!row) return null;
  const [items, profileRows] = await Promise.all([
    database.select().from(orderItems).where(eq(orderItems.orderId, row.order.id)).orderBy(asc(orderItems.id)),
    database.select().from(customerProfiles).where(eq(customerProfiles.userId, row.customerUser.id)).limit(1),
  ]);
  return {
    order: row.order,
    customer: { user: row.customerUser, profile: profileRows[0] ?? null },
    payment: row.payment,
    items,
  };
}

export const adminCustomerListInput = z.object({
  search: z.string().trim().max(160).optional(),
  role: z.enum(["customer", "seller", "staff", "admin"] as const).optional(),
  offset: z.number().int().min(0).max(MAX_OFFSET).default(0),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
}).strict();
export const adminCustomerDetailInput = z.object({
  userId: z.number().int().positive(),
  orderLimit: z.number().int().min(1).max(MAX_CUSTOMER_ORDER_HISTORY).default(25),
}).strict();
export type AdminCustomerListInput = z.input<typeof adminCustomerListInput>;

function customerConditions(input: z.output<typeof adminCustomerListInput>) {
  const conditions: SqlCondition[] = [];
  if (input.role) conditions.push(eq(users.role, input.role));
  const search = input.search?.trim();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(ilike(users.name, pattern), ilike(users.email, pattern))!);
  }
  return conditions;
}

async function verifiedSpendByCustomer(database: Database, customerIds: number[]) {
  const result = new Map<number, { orderCount: number; spendKobo: number }>();
  if (!customerIds.length) return result;
  const rows = await database.select({
    customerUserId: orders.customerUserId,
    orderId: orders.id,
    amountKobo: paymentTransactions.amountKobo,
    orderTotalKobo: orders.totalKobo,
    currency: paymentTransactions.currency,
    orderCurrency: orders.currency,
  }).from(orders).innerJoin(paymentTransactions, eq(paymentTransactions.orderId, orders.id))
    .where(and(
      inArray(orders.customerUserId, customerIds),
      eq(paymentTransactions.status, "succeeded"),
      inArray(orders.status, [...PAID_ORDER_STATUSES]),
      isNotNull(paymentTransactions.verifiedAt),
    ));
  for (const row of rows) {
    if (sumSafeVerifiedKobo([row]) !== row.amountKobo) continue;
    const current = result.get(row.customerUserId) ?? { orderCount: 0, spendKobo: 0 };
    current.orderCount += 1;
    if (row.amountKobo <= Number.MAX_SAFE_INTEGER - current.spendKobo) current.spendKobo += row.amountKobo;
    result.set(row.customerUserId, current);
  }
  return result;
}

export async function listAdminCustomers(input: AdminCustomerListInput = {}) {
  const normalized = adminCustomerListInput.parse(input);
  const database = requireDatabase(await getDb());
  const { offset, limit } = boundedPage(normalized);
  const conditions = customerConditions(normalized);
  const where = whereAll(conditions);
  const [rows, totals] = await Promise.all([
    database.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
    }).from(users).where(where).orderBy(desc(users.createdAt), desc(users.id)).offset(offset).limit(limit),
    database.select({ value: count() }).from(users).where(where),
  ]);
  const spend = await verifiedSpendByCustomer(database, rows.map(row => row.id));
  const total = countValue(totals[0]);
  return {
    items: rows.map(row => ({ ...row, ...(spend.get(row.id) ?? { orderCount: 0, spendKobo: 0 }) })),
    total,
    offset,
    limit,
    hasMore: offset + rows.length < total,
  };
}

export async function getAdminCustomerDetail(userId: number, historyLimit = 25) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Customer ID must be a positive integer." });
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1 || historyLimit > MAX_CUSTOMER_ORDER_HISTORY) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Order history limit must be between 1 and ${MAX_CUSTOMER_ORDER_HISTORY}.` });
  }
  const database = requireDatabase(await getDb());
  const usersRows = await database.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    createdAt: users.createdAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).where(eq(users.id, userId)).limit(1);
  const user = usersRows[0];
  if (!user) return null;
  const [profileRows, orderRows] = await Promise.all([
    database.select().from(customerProfiles).where(eq(customerProfiles.userId, userId)).limit(1),
    database.select({
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
      totalKobo: orders.totalKobo,
      currency: orders.currency,
      createdAt: orders.createdAt,
      paymentStatus: paymentTransactions.status,
      paymentVerifiedAt: paymentTransactions.verifiedAt,
    }).from(orders).innerJoin(paymentTransactions, eq(paymentTransactions.orderId, orders.id))
      .where(and(
        eq(orders.customerUserId, userId),
        eq(paymentTransactions.status, "succeeded"),
        inArray(orders.status, [...PAID_ORDER_STATUSES]),
        isNotNull(paymentTransactions.verifiedAt),
      )).orderBy(desc(orders.createdAt), desc(orders.id)).limit(historyLimit + 1),
  ]);
  const hasMore = orderRows.length > historyLimit;
  return {
    user,
    profile: profileRows[0] ?? null,
    orders: { items: orderRows.slice(0, historyLimit), limit: historyLimit, hasMore },
  };
}

export function getAdminProviderSettings() {
  const paystackConfigured = Boolean(ENV.paystackSecretKey && ENV.appBaseUrl);
  const cloudinaryConfigured = Boolean(ENV.cloudinaryCloudName && ENV.cloudinaryApiKey && ENV.cloudinaryApiSecret);
  return {
    providers: {
      paystack: {
        configured: paystackConfigured,
        supportedOperations: ["hosted_checkout", "verify_payment", "reconcile_payment"] as const,
      },
      cloudinary: {
        configured: cloudinaryConfigured,
        supportedOperations: ["product_image_upload"] as const,
      },
    },
    settings: {
      production: ENV.isProduction,
      databaseConfigured: Boolean(ENV.databaseUrl),
    },
  };
}

export type AdminFulfillmentInput = {
  actorUserId: number;
  orderItemId: number;
  status: FulfillmentStatus;
  carrier?: string | null;
  trackingNumber?: string | null;
};

export async function updateAdminOrderItemFulfillment(input: AdminFulfillmentInput) {
  const database = requireDatabase(await getDb());
  return database.transaction(async tx => {
    const actorRows = await tx.select({ id: users.id, role: users.role }).from(users)
      .where(eq(users.id, input.actorUserId)).limit(1).for("update");
    if (actorRows[0]?.role !== "admin") return { success: false as const, reason: "admin_required" as const };

    // The order lock intentionally precedes the item lock so sibling updates serialize.
    const orderRows = await tx.select().from(orders).where(eq(orders.id, sql`(select "orderId" from "orderItems" where "id" = ${input.orderItemId})`)).limit(1).for("update");
    const order = orderRows[0];
    if (!order) return { success: false as const, reason: "not_found" as const };

    const paymentRows = await tx.select({ status: paymentTransactions.status }).from(paymentTransactions)
      .where(eq(paymentTransactions.orderId, order.id)).limit(1).for("update");
    if (paymentRows[0]?.status !== "succeeded" || !PAID_ORDER_STATUSES.includes(order.status as typeof PAID_ORDER_STATUSES[number])) {
      return { success: false as const, reason: "order_not_fulfillable" as const };
    }

    const itemRows = await tx.select().from(orderItems).where(and(eq(orderItems.id, input.orderItemId), eq(orderItems.orderId, order.id))).limit(1).for("update");
    const item = itemRows[0];
    if (!item) return { success: false as const, reason: "not_found" as const };
    if (!fulfillmentStatuses.includes(input.status)) return { success: false as const, reason: "invalid_transition" as const };
    if (!canTransitionFulfillment(item.fulfillmentStatus, input.status)) return { success: false as const, reason: "invalid_transition" as const };

    const now = new Date();
    const updatedRows = await tx.update(orderItems).set({
      fulfillmentStatus: input.status,
      updatedAt: now,
      ...(input.carrier === undefined ? {} : { carrier: input.carrier }),
      ...(input.trackingNumber === undefined ? {} : { trackingNumber: input.trackingNumber }),
      ...(input.status === "fulfilled" ? { fulfilledAt: item.fulfilledAt ?? now } : {}),
    }).where(and(eq(orderItems.id, item.id), eq(orderItems.orderId, order.id))).returning();
    const updatedItem = updatedRows[0];
    if (!updatedItem) throw new Error("Admin fulfillment update lost its item lock.");

    const siblingItems = await tx.select({ status: orderItems.fulfillmentStatus }).from(orderItems)
      .where(eq(orderItems.orderId, order.id)).for("update");
    const nextOrderStatus = deriveFulfillmentOrderStatus(siblingItems.map(sibling => sibling.status));
    if (nextOrderStatus !== order.status) {
      const changedOrder = await tx.update(orders).set({ status: nextOrderStatus, updatedAt: now })
        .where(and(eq(orders.id, order.id), inArray(orders.status, [...PAID_ORDER_STATUSES]))).returning({ id: orders.id });
      if (changedOrder.length !== 1) throw new Error("Order fulfillment status changed concurrently.");
    }
    await tx.insert(accountAuditEvents).values({
      actorUserId: input.actorUserId,
      targetUserId: order.customerUserId,
      eventType: "admin_order_item_fulfillment_updated",
      metadata: {
        orderReference: order.reference,
        orderItemId: updatedItem.id,
        fulfillmentStatus: updatedItem.fulfillmentStatus,
        previousFulfillmentStatus: item.fulfillmentStatus,
      },
    });
    return { success: true as const, item: updatedItem, orderStatus: nextOrderStatus, actorUserId: input.actorUserId };
  });
}

export const adminFulfillmentInput = z.object({
  orderItemId: z.number().int().positive(),
  status: z.enum(orderItemStatuses),
  carrier: z.string().trim().min(1).max(100).nullable().optional(),
  trackingNumber: z.string().trim().min(1).max(120).nullable().optional(),
}).strict();

export const adminOperationsRouter = router({
  overview: adminProcedure.query(() => getAdminOverview()),
  categories: adminProcedure.query(() => getAdminCategories()),
  orders: router({
    list: adminProcedure.input(adminOrderListInput).query(({ input }) => listAdminOrders(input)),
    detail: adminProcedure.input(adminOrderDetailInput).query(async ({ input }) => {
      const result = await getAdminOrderDetail(input.reference);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found." });
      return result;
    }),
  }),
  customers: router({
    list: adminProcedure.input(adminCustomerListInput).query(({ input }) => listAdminCustomers(input)),
    detail: adminProcedure.input(adminCustomerDetailInput).query(async ({ input }) => {
      const result = await getAdminCustomerDetail(input.userId, input.orderLimit);
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found." });
      return result;
    }),
  }),
  providers: adminProcedure.query(() => getAdminProviderSettings()),
  settings: adminProcedure.query(() => getAdminProviderSettings()),
  updateOrderItemFulfillment: adminProcedure.input(adminFulfillmentInput).mutation(async ({ ctx, input }) => {
    const result = await updateAdminOrderItemFulfillment({ actorUserId: ctx.user.id, ...input });
    if (result.success) return result;
    const message = result.reason === "not_found"
      ? "Order item not found."
      : result.reason === "admin_required"
        ? "Administrator access is required for this fulfillment action."
        : "Only paid orders with successful payments can be fulfilled.";
    throw new TRPCError({ code: result.reason === "not_found" ? "NOT_FOUND" : "CONFLICT", message });
  }),
});

export type AdminOperationsRouter = typeof adminOperationsRouter;
export const adminOperationRouter = adminOperationsRouter;
