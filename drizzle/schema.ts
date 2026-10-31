import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const accountRoles = ["customer", "seller", "staff", "admin"] as const;
export const sellerApplicationStatuses = ["pending", "approved", "rejected", "suspended"] as const;
export const productStatuses = ["draft", "published", "archived"] as const;
export const orderStatuses = ["pending_payment", "paid", "partially_fulfilled", "payment_failed", "cancelled", "fulfilled"] as const;
export const orderItemStatuses = ["unfulfilled", "processing", "shipped", "fulfilled"] as const;
export const paymentStatuses = ["pending", "succeeded", "failed"] as const;
export const deliveryMethods = ["standard", "express"] as const;

export const accountRoleEnum = pgEnum("account_role", accountRoles);
export const sellerApplicationStatusEnum = pgEnum("seller_application_status", sellerApplicationStatuses);
export const productStatusEnum = pgEnum("product_status", productStatuses);
export const orderStatusEnum = pgEnum("order_status", orderStatuses);
export const orderItemStatusEnum = pgEnum("order_item_status", orderItemStatuses);
export const paymentStatusEnum = pgEnum("payment_status", paymentStatuses);
export const deliveryMethodEnum = pgEnum("delivery_method", deliveryMethods);
export const paymentProviderEnum = pgEnum("payment_provider", ["paystack"]);

const createdAt = () => timestamp("createdAt", { withTimezone: true, mode: "date" }).defaultNow().notNull();
const updatedAt = () => timestamp("updatedAt", { withTimezone: true, mode: "date" }).defaultNow().notNull();

/** One Clerk identity per person. Privileged roles are assigned only by trusted server operations. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 255 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: accountRoleEnum("role").default("customer").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
});

/** Server-only marker prevents a later login from silently re-promoting an owner account. */
export const adminBootstrap = pgTable("adminBootstrap", {
  key: varchar("key", { length: 64 }).primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
});

/** A customer may submit one seller application, reviewed by staff or an administrator. */
export const sellerApplications = pgTable("sellerApplications", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  legalName: varchar("legalName", { length: 160 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  businessName: varchar("businessName", { length: 160 }).notNull(),
  craftSummary: text("craftSummary").notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  status: sellerApplicationStatusEnum("status").default("pending").notNull(),
  reviewNote: text("reviewNote"),
  reviewedByUserId: integer("reviewedByUserId").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewedAt", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => ({
  userUnique: uniqueIndex("sellerApplications_userId_unique").on(table.userId),
  statusUpdatedIdx: index("sellerApplications_status_updatedAt_idx").on(table.status, table.updatedAt),
  reviewerIdx: index("sellerApplications_reviewer_idx").on(table.reviewedByUserId),
}));

/** Append-only audit trail for privileged account and seller-review actions. */
export const accountAuditEvents = pgTable("accountAuditEvents", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actorUserId").references(() => users.id, { onDelete: "set null" }),
  targetUserId: integer("targetUserId").references(() => users.id, { onDelete: "set null" }),
  eventType: varchar("eventType", { length: 96 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: createdAt(),
}, table => ({
  targetCreatedIdx: index("accountAuditEvents_target_createdAt_idx").on(table.targetUserId, table.createdAt),
  actorCreatedIdx: index("accountAuditEvents_actor_createdAt_idx").on(table.actorUserId, table.createdAt),
}));

/** Customer-owned contact and shipping profile. Checkout snapshots these fields onto each order. */
export const customerProfiles = pgTable("customerProfiles", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  address: varchar("address", { length: 300 }).notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => ({ userUnique: uniqueIndex("customerProfiles_userId_unique").on(table.userId) }));

/** Approved sellers get a separate workspace bound to their authenticated account ID. */
export const sellerStores = pgTable("sellerStores", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("displayName", { length: 160 }).notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => ({ userUnique: uniqueIndex("sellerStores_userId_unique").on(table.userId) }));

/** Every seller-created listing is owned by one seller account. Draft is the safe default. */
export const sellerProducts = pgTable("sellerProducts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  sellerUserId: integer("sellerUserId").notNull().references(() => users.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 180 }).notNull(),
  description: text("description").notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  priceKobo: integer("priceKobo").notNull(),
  imageUrl: text("imageUrl"),
  sizes: jsonb("sizes").$type<string[]>().notNull(),
  inventoryCount: integer("inventoryCount").default(0).notNull(),
  status: productStatusEnum("status").default("draft").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => ({
  sellerCreatedIdx: index("sellerProducts_seller_createdAt_idx").on(table.sellerUserId, table.createdAt),
  publicCatalogIdx: index("sellerProducts_status_category_idx").on(table.status, table.category),
  positivePrice: check("sellerProducts_positive_price", sql`${table.priceKobo} > 0`),
  nonnegativeInventory: check("sellerProducts_nonnegative_inventory", sql`${table.inventoryCount} >= 0`),
}));

/** Order records are private to the authenticated customer; amounts are stored in kobo. */
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  reference: varchar("reference", { length: 64 }).notNull().unique(),
  customerUserId: integer("customerUserId").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotencyKey", { length: 64 }).notNull(),
  idempotencyFingerprint: varchar("idempotencyFingerprint", { length: 64 }).notNull(),
  status: orderStatusEnum("status").default("pending_payment").notNull(),
  currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  address: varchar("address", { length: 300 }).notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  deliveryMethod: deliveryMethodEnum("deliveryMethod").notNull(),
  subtotalKobo: integer("subtotalKobo").notNull(),
  shippingKobo: integer("shippingKobo").notNull(),
  totalKobo: integer("totalKobo").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => ({
  customerIdempotencyUnique: uniqueIndex("orders_customer_idempotency_unique").on(table.customerUserId, table.idempotencyKey),
  customerCreatedIdx: index("orders_customer_createdAt_idx").on(table.customerUserId, table.createdAt),
  statusCreatedIdx: index("orders_status_createdAt_idx").on(table.status, table.createdAt),
  totalsConsistent: check("orders_totals_consistent", sql`${table.subtotalKobo} >= 0 AND ${table.shippingKobo} >= 0 AND ${table.totalKobo} = ${table.subtotalKobo} + ${table.shippingKobo}`),
  ngnCurrency: check("orders_ngn_currency", sql`${table.currency} = 'NGN'`),
}));

/** Item and seller snapshots preserve what was purchased even if a listing later changes. */
export const orderItems = pgTable("orderItems", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull().references(() => orders.id, { onDelete: "cascade" }),
  productId: varchar("productId", { length: 64 }).notNull().references(() => sellerProducts.id, { onDelete: "restrict" }),
  sellerUserId: integer("sellerUserId").notNull().references(() => users.id, { onDelete: "restrict" }),
  nameSnapshot: varchar("nameSnapshot", { length: 180 }).notNull(),
  makerSnapshot: varchar("makerSnapshot", { length: 160 }).notNull(),
  unitPriceKobo: integer("unitPriceKobo").notNull(),
  quantity: integer("quantity").notNull(),
  size: varchar("size", { length: 40 }).notNull(),
  lineTotalKobo: integer("lineTotalKobo").notNull(),
  fulfillmentStatus: orderItemStatusEnum("fulfillmentStatus").default("unfulfilled").notNull(),
  carrier: varchar("carrier", { length: 100 }),
  trackingNumber: varchar("trackingNumber", { length: 120 }),
  fulfilledAt: timestamp("fulfilledAt", { withTimezone: true, mode: "date" }),
  updatedAt: updatedAt(),
}, table => ({
  orderIdx: index("orderItems_order_idx").on(table.orderId),
  sellerOrderIdx: index("orderItems_seller_order_idx").on(table.sellerUserId, table.orderId),
  lineTotalConsistent: check("orderItems_total_consistent", sql`${table.unitPriceKobo} > 0 AND ${table.quantity} > 0 AND ${table.lineTotalKobo} = ${table.unitPriceKobo} * ${table.quantity}`),
}));

/** Paystack transaction references and hosted URLs are server-owned; no card data is stored. */
export const paymentTransactions = pgTable("paymentTransactions", {
  id: serial("id").primaryKey(),
  orderId: integer("orderId").notNull().references(() => orders.id, { onDelete: "restrict" }),
  provider: paymentProviderEnum("provider").default("paystack").notNull(),
  reference: varchar("reference", { length: 64 }).notNull().unique(),
  status: paymentStatusEnum("status").default("pending").notNull(),
  amountKobo: integer("amountKobo").notNull(),
  currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
  checkoutUrl: text("checkoutUrl"),
  providerTransactionId: varchar("providerTransactionId", { length: 64 }),
  verifiedAt: timestamp("verifiedAt", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => ({
  orderUnique: uniqueIndex("paymentTransactions_order_unique").on(table.orderId),
  statusCreatedIdx: index("paymentTransactions_status_createdAt_idx").on(table.status, table.createdAt),
  statusIdIdx: index("paymentTransactions_status_id_idx").on(table.status, table.id),
  providerTransactionIdUnique: uniqueIndex("paymentTransactions_providerTransactionId_unique")
    .on(table.providerTransactionId).where(sql`${table.providerTransactionId} IS NOT NULL`),
  positiveAmount: check("paymentTransactions_positive_amount", sql`${table.amountKobo} > 0`),
  ngnCurrency: check("paymentTransactions_ngn_currency", sql`${table.currency} = 'NGN'`),
}));

export type AccountRole = (typeof accountRoles)[number];
export type SellerApplicationStatus = (typeof sellerApplicationStatuses)[number];
export type ProductStatus = (typeof productStatuses)[number];
export type OrderStatus = (typeof orderStatuses)[number];
export type PaymentStatus = (typeof paymentStatuses)[number];
export type DeliveryMethod = (typeof deliveryMethods)[number];
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type SellerApplication = typeof sellerApplications.$inferSelect;
export type InsertSellerApplication = typeof sellerApplications.$inferInsert;
export type AccountAuditEvent = typeof accountAuditEvents.$inferSelect;
export type CustomerProfile = typeof customerProfiles.$inferSelect;
export type SellerStore = typeof sellerStores.$inferSelect;
export type SellerProduct = typeof sellerProducts.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
