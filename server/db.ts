import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, gt, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  accountAuditEvents,
  adminBootstrap,
  customerProfiles,
  orders,
  orderItems,
  paymentTransactions,
  sellerApplications,
  sellerProducts,
  sellerStores,
  users,
  type AccountRole,
  type DeliveryMethod,
  type InsertUser,
  type SellerApplicationStatus,
} from "../drizzle/schema";
import { canBootstrapInitialAdmin, canTransitionSellerApplication } from "./_core/authorization";
import { ENV } from "./_core/env";
import { canTransitionFulfillment, deriveFulfillmentOrderStatus, type FulfillmentStatus } from "./commerce/fulfillment";
import { checkoutFingerprint } from "./commerce/idempotency";
import { calculateCheckoutAmounts } from "./commerce/pricing";

function hasPostgresConstraint(error: unknown, constraint: string, seen = new Set<object>()): boolean {
  if (!error || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);
  const candidate = error as { constraint?: unknown; cause?: unknown };
  return candidate.constraint === constraint || hasPostgresConstraint(candidate.cause, constraint, seen);
}

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

type ClerkUserInput = Pick<InsertUser, "name" | "email" | "lastSignedIn"> & { clerkUserId: string };

export class CommerceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommerceValidationError";
  }
}

// Runtime uses Neon’s pooled connection string. Drizzle migrations use the direct URL.
export async function getDb() {
  if (!_db && ENV.databaseUrl) {
    _pool = new Pool({
      connectionString: ENV.databaseUrl,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    _pool.on("error", error => console.warn("[Database] Idle connection error:", error.message));
    _db = drizzle(_pool);
  }
  return _db;
}

async function requireDb() {
  const database = await getDb();
  if (!database) throw new Error("Database is not available");
  return database;
}

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function findExistingPendingCheckout(
  database: Database,
  customerUserId: number,
  idempotencyKey: string,
  fingerprint: string,
) {
  const previous = await database.select({ order: orders, payment: paymentTransactions })
    .from(orders).innerJoin(paymentTransactions, eq(paymentTransactions.orderId, orders.id))
    .where(and(
      eq(orders.customerUserId, customerUserId),
      eq(orders.idempotencyKey, idempotencyKey),
    )).limit(1);
  const record = previous[0];
  if (!record) return undefined;
  if (record.order.idempotencyFingerprint !== fingerprint) {
    throw new CommerceValidationError("This idempotency key was already used for a different checkout. Start a new checkout attempt.");
  }
  if (record.order.status !== "pending_payment" || record.payment.status !== "pending") {
    throw new CommerceValidationError("This checkout attempt is no longer active. Start a new checkout attempt.");
  }
  return {
    order: record.order,
    paymentReference: record.payment.reference,
    authorizationUrl: record.payment.checkoutUrl,
    existing: true as const,
  };
}

function isIdempotencyUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === "orders_customer_idempotency_unique") return true;
    current = candidate.cause;
  }
  return false;
}

/** Synchronizes Clerk identity fields only; client identity data cannot set application roles. */
export async function upsertClerkUser(user: ClerkUserInput): Promise<void> {
  if (!user.clerkUserId) throw new Error("Clerk user ID is required for upsert");
  const database = await requireDb();
  const lastSignedIn = user.lastSignedIn ?? new Date();
  const values: InsertUser = { openId: user.clerkUserId, loginMethod: "clerk", lastSignedIn };
  const updateSet: Partial<InsertUser> = { loginMethod: "clerk", lastSignedIn, updatedAt: new Date() };
  if (user.name !== undefined) { values.name = user.name ?? null; updateSet.name = user.name ?? null; }
  if (user.email !== undefined) { values.email = user.email ?? null; updateSet.email = user.email ?? null; }

  await database.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet });
  await ensureInitialAdminForClerkUser(user.clerkUserId);
}

export async function ensureInitialAdminForClerkUser(clerkUserId: string) {
  if (ENV.ownerClerkUserId && clerkUserId === ENV.ownerClerkUserId) {
    await bootstrapFirstAdministrator(clerkUserId);
  }
}

async function bootstrapFirstAdministrator(ownerClerkUserId: string) {
  const database = await requireDb();
  await database.transaction(async tx => {
    // Serialize concurrent first logins. This lock is internal and not user-selectable.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(2481051731)`);
    const bootstraps = await tx.select({ key: adminBootstrap.key }).from(adminBootstrap)
      .where(eq(adminBootstrap.key, "initial-admin")).limit(1);
    const admins = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
    const owner = await tx.select({ id: users.id, role: users.role }).from(users)
      .where(eq(users.openId, ownerClerkUserId)).limit(1);
    if (!canBootstrapInitialAdmin({
      configuredOwnerClerkUserId: ENV.ownerClerkUserId,
      authenticatedClerkUserId: ownerClerkUserId,
      bootstrapExists: bootstraps.length > 0,
      administratorExists: admins.length > 0,
      ownerRole: owner[0]?.role ?? null,
    })) return;
    const ownerAccount = owner[0]!;

    const promoted = await tx.update(users).set({ role: "admin", updatedAt: new Date() })
      .where(and(eq(users.id, ownerAccount.id), eq(users.role, "customer")))
      .returning({ id: users.id });
    if (promoted.length !== 1) return;
    await tx.insert(adminBootstrap).values({ key: "initial-admin", userId: ownerAccount.id });
    await tx.insert(accountAuditEvents).values({
      actorUserId: ownerAccount.id,
      targetUserId: ownerAccount.id,
      eventType: "initial_admin_bootstrapped",
      metadata: { method: "configured_owner_clerk_identity" },
    });
  });
}

export async function getUserByClerkId(clerkUserId: string) {
  const database = await getDb();
  if (!database) return undefined;
  const result = await database.select().from(users).where(eq(users.openId, clerkUserId)).limit(1);
  return result[0];
}

export async function getUserById(id: number) {
  const database = await getDb();
  if (!database) return undefined;
  const result = await database.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function listUsersForAdmin() {
  const database = await requireDb();
  return database.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    createdAt: users.createdAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).orderBy(desc(users.createdAt)).limit(200);
}

export async function listPendingPaymentsForAdmin(input: { afterId?: number; limit?: number } = {}) {
  const database = await requireDb();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const rows = await database.select({
    id: paymentTransactions.id,
    reference: paymentTransactions.reference,
    orderReference: orders.reference,
    amountKobo: paymentTransactions.amountKobo,
    currency: paymentTransactions.currency,
    createdAt: paymentTransactions.createdAt,
  }).from(paymentTransactions).innerJoin(orders, eq(paymentTransactions.orderId, orders.id))
    .where(and(
      eq(paymentTransactions.status, "pending"),
      eq(orders.status, "pending_payment"),
      ...(input.afterId === undefined ? [] : [gt(paymentTransactions.id, input.afterId)]),
    )).orderBy(asc(paymentTransactions.id)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}

export type SellerApplicationInput = {
  legalName: string;
  email: string;
  businessName: string;
  craftSummary: string;
  phone: string;
  city: string;
};

export async function getSellerApplicationByUserId(userId: number) {
  const database = await getDb();
  if (!database) return undefined;
  const result = await database.select().from(sellerApplications).where(eq(sellerApplications.userId, userId)).limit(1);
  return result[0];
}

export async function getSellerApplicationById(id: number) {
  const database = await getDb();
  if (!database) return undefined;
  const result = await database.select().from(sellerApplications).where(eq(sellerApplications.id, id)).limit(1);
  return result[0];
}

export async function createSellerApplication(userId: number, input: SellerApplicationInput) {
  const database = await requireDb();
  await database.insert(sellerApplications).values({ userId, ...input, status: "pending" });
  return getSellerApplicationByUserId(userId);
}

export async function listSellerApplications(status?: SellerApplicationStatus) {
  const database = await requireDb();
  const selection = {
    application: sellerApplications,
    applicant: { id: users.id, name: users.name, email: users.email, role: users.role },
  };
  if (status) {
    return database.select(selection).from(sellerApplications)
      .innerJoin(users, eq(sellerApplications.userId, users.id))
      .where(eq(sellerApplications.status, status))
      .orderBy(desc(sellerApplications.updatedAt));
  }
  return database.select(selection).from(sellerApplications)
    .innerJoin(users, eq(sellerApplications.userId, users.id))
    .orderBy(desc(sellerApplications.updatedAt));
}

/** Updates seller role, store availability, workflow state, and audit log atomically. */
export async function transitionSellerApplication(input: {
  applicationId: number;
  reviewerUserId: number;
  status: SellerApplicationStatus;
  reviewNote?: string;
}) {
  const database = await requireDb();
  return database.transaction(async tx => {
    const applications = await tx.select().from(sellerApplications)
      .where(eq(sellerApplications.id, input.applicationId)).limit(1);
    const application = applications[0];
    if (!application) return { success: false as const, reason: "not_found" as const };
    if (!canTransitionSellerApplication(application.status, input.status)) {
      return { success: false as const, reason: "invalid_transition" as const };
    }
    const applicants = await tx.select().from(users).where(eq(users.id, application.userId)).limit(1);
    const applicant = applicants[0];
    if (!applicant) return { success: false as const, reason: "account_missing" as const };
    if (applicant.role === "staff" || applicant.role === "admin") {
      return { success: false as const, reason: "privileged_account" as const };
    }
    const updated = await tx.update(sellerApplications).set({
      status: input.status,
      reviewNote: input.reviewNote || null,
      reviewedByUserId: input.reviewerUserId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(sellerApplications.id, input.applicationId),
      eq(sellerApplications.status, application.status),
    )).returning({ id: sellerApplications.id });
    if (updated.length !== 1) return { success: false as const, reason: "concurrent_change" as const };

    const resultingRole: AccountRole = input.status === "approved" ? "seller" : "customer";
    await tx.update(users).set({ role: resultingRole, updatedAt: new Date() }).where(eq(users.id, application.userId));
    if (input.status === "approved") {
      await tx.insert(sellerStores).values({
        userId: application.userId,
        displayName: application.businessName,
        city: application.city,
        isActive: true,
      }).onConflictDoUpdate({
        target: sellerStores.userId,
        set: { displayName: application.businessName, city: application.city, isActive: true, updatedAt: new Date() },
      });
    } else if (input.status === "suspended") {
      await tx.update(sellerStores).set({ isActive: false, updatedAt: new Date() })
        .where(eq(sellerStores.userId, application.userId));
    }
    await tx.insert(accountAuditEvents).values({
      actorUserId: input.reviewerUserId,
      targetUserId: application.userId,
      eventType: "seller_application_status_changed",
      metadata: { applicationId: application.id, from: application.status, to: input.status },
    });
    const reviewed = await tx.select().from(sellerApplications)
      .where(eq(sellerApplications.id, input.applicationId)).limit(1);
    return { success: true as const, application: reviewed[0]! };
  });
}

/** Staff access is granted only to customers and revoked only from staff accounts. */
export async function changeStaffAccess(input: {
  actorUserId: number;
  targetUserId: number;
  grant: boolean;
}) {
  const database = await requireDb();
  return database.transaction(async tx => {
    const targets = await tx.select().from(users).where(eq(users.id, input.targetUserId)).limit(1);
    const target = targets[0];
    if (!target) return { success: false as const, reason: "not_found" as const };
    if (input.actorUserId === input.targetUserId) return { success: false as const, reason: "self_change" as const };
    if (target.role === "admin") return { success: false as const, reason: "admin_protected" as const };
    const expectedRole: AccountRole = input.grant ? "customer" : "staff";
    const nextRole: AccountRole = input.grant ? "staff" : "customer";
    if (target.role !== expectedRole) return { success: false as const, reason: "invalid_role_transition" as const };
    const updated = await tx.update(users).set({ role: nextRole, updatedAt: new Date() })
      .where(and(eq(users.id, input.targetUserId), eq(users.role, expectedRole)))
      .returning({ id: users.id });
    if (updated.length !== 1) return { success: false as const, reason: "concurrent_change" as const };
    await tx.insert(accountAuditEvents).values({
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      eventType: input.grant ? "staff_access_granted" : "staff_access_revoked",
      metadata: { from: expectedRole, to: nextRole },
    });
    const result = await tx.select().from(users).where(eq(users.id, input.targetUserId)).limit(1);
    return { success: true as const, user: result[0]! };
  });
}

export async function createAccountAuditEvent(input: {
  actorUserId?: number | null;
  targetUserId?: number | null;
  eventType: string;
  metadata?: Record<string, unknown>;
}) {
  const database = await requireDb();
  await database.insert(accountAuditEvents).values({
    actorUserId: input.actorUserId ?? null,
    targetUserId: input.targetUserId ?? null,
    eventType: input.eventType,
    metadata: input.metadata ?? null,
  });
}

export type CustomerProfileInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
};

export async function getCustomerProfile(userId: number) {
  const database = await getDb();
  if (!database) return undefined;
  const result = await database.select().from(customerProfiles).where(eq(customerProfiles.userId, userId)).limit(1);
  return result[0];
}

export async function saveCustomerProfile(userId: number, input: CustomerProfileInput) {
  const database = await requireDb();
  const now = new Date();
  await database.insert(customerProfiles).values({ userId, ...input }).onConflictDoUpdate({
    target: customerProfiles.userId,
    set: { ...input, updatedAt: now },
  });
  return getCustomerProfile(userId);
}

export type SellerProductInput = {
  name: string;
  description: string;
  category: string;
  priceKobo: number;
  imageUrl?: string | null;
  sizes: string[];
  inventoryCount: number;
};

export async function listSellerProducts(sellerUserId: number) {
  const database = await requireDb();
  return database.select().from(sellerProducts).where(eq(sellerProducts.sellerUserId, sellerUserId))
    .orderBy(desc(sellerProducts.updatedAt)).limit(100);
}

export async function createSellerProduct(sellerUserId: number, input: SellerProductInput) {
  const database = await requireDb();
  const id = `prod_${randomUUID().replaceAll("-", "")}`;
  const result = await database.insert(sellerProducts).values({
    id,
    sellerUserId,
    ...input,
    imageUrl: input.imageUrl ?? null,
    status: "draft",
  }).returning();
  return result[0]!;
}

export async function getSellerStoreByUserId(userId: number) {
  const database = await getDb();
  if (!database) return undefined;
  const result = await database.select().from(sellerStores).where(eq(sellerStores.userId, userId)).limit(1);
  return result[0];
}

export async function updateSellerProduct(input: {
  sellerUserId: number;
  productId: string;
  changes: Partial<SellerProductInput> & { status?: "draft" | "published" | "archived" };
}) {
  const database = await requireDb();
  return database.transaction(async tx => {
    const existing = await tx.select().from(sellerProducts).where(and(
        eq(sellerProducts.id, input.productId),
        eq(sellerProducts.sellerUserId, input.sellerUserId),
      )).limit(1).for("update");
    if (!existing.length) return undefined;

    if (input.changes.inventoryCount !== undefined) {
      const pendingReservations = await tx.select({ itemId: orderItems.id })
        .from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(and(
          eq(orderItems.productId, input.productId),
          eq(orders.status, "pending_payment"),
        )).limit(1);
      if (pendingReservations.length) {
        throw new CommerceValidationError("Inventory cannot be edited while customers have pending payment reservations for this listing.");
      }
    }

    if (input.changes.status === "published") {
      const available = input.changes.inventoryCount ?? existing[0]!.inventoryCount;
      const stores = await tx.select().from(sellerStores)
        .where(eq(sellerStores.userId, input.sellerUserId)).limit(1).for("update");
      const store = stores[0];
      if (!store?.isActive) throw new CommerceValidationError("The seller store is not active.");
      if (available < 1) throw new CommerceValidationError("A listing needs available stock before it can be published.");
    }

    const result = await tx.update(sellerProducts).set({
      ...input.changes,
      updatedAt: new Date(),
    }).where(and(
      eq(sellerProducts.id, input.productId),
      eq(sellerProducts.sellerUserId, input.sellerUserId),
    )).returning();
    return result[0];
  });
}

export async function listPublicSellerProducts() {
  const database = await requireDb();
  return database.select({
    id: sellerProducts.id,
    name: sellerProducts.name,
    description: sellerProducts.description,
    category: sellerProducts.category,
    priceKobo: sellerProducts.priceKobo,
    imageUrl: sellerProducts.imageUrl,
    sizes: sellerProducts.sizes,
    inventoryCount: sellerProducts.inventoryCount,
    maker: sellerStores.displayName,
    city: sellerStores.city,
  })
    .from(sellerProducts).innerJoin(sellerStores, eq(sellerProducts.sellerUserId, sellerStores.userId))
    .where(and(
      eq(sellerProducts.status, "published"),
      gte(sellerProducts.inventoryCount, 1),
      eq(sellerStores.isActive, true),
    )).orderBy(desc(sellerProducts.createdAt)).limit(200);
}

export type CheckoutItemInput = { productId: string; quantity: number; size: string };
export type CreateOrderInput = CustomerProfileInput & {
  idempotencyKey: string;
  deliveryMethod: DeliveryMethod;
  items: CheckoutItemInput[];
};

/** Prices, seller ownership, inventory, shipping, and snapshots are resolved server-side. */
export async function createPendingOrder(customerUserId: number, input: CreateOrderInput) {
  const database = await requireDb();
  const fingerprint = checkoutFingerprint(input);
  const previous = await findExistingPendingCheckout(database, customerUserId, input.idempotencyKey, fingerprint);
  if (previous) return previous;
  const grouped = new Map<string, CheckoutItemInput>();
  for (const line of input.items) {
    const key = `${line.productId}\u0000${line.size}`;
    const existing = grouped.get(key);
    grouped.set(key, { ...line, quantity: (existing?.quantity ?? 0) + line.quantity });
  }
  const requested = [...grouped.values()];
  if (requested.some(line => line.quantity > 20)) {
    throw new CommerceValidationError("An item quantity cannot exceed 20.");
  }
  const productIds = [...new Set(requested.map(line => line.productId))];

  try {
    return await database.transaction(async tx => {
    const catalogRows = await tx.select().from(sellerProducts)
      .where(inArray(sellerProducts.id, productIds)).for("update");
    const productsById = new Map(catalogRows.map(product => [product.id, product]));
    const storeRows = await tx.select().from(sellerStores)
      .where(inArray(sellerStores.userId, [...new Set(catalogRows.map(product => product.sellerUserId))])).for("update");
    const storesByOwner = new Map(storeRows.map(store => [store.userId, store]));
    const orderLines = requested.map(line => {
      const product = productsById.get(line.productId);
      const store = product ? storesByOwner.get(product.sellerUserId) : undefined;
      if (!product || product.status !== "published" || !store?.isActive) {
        throw new CommerceValidationError("One or more items are no longer available.");
      }
      if (!product.sizes.includes(line.size)) throw new CommerceValidationError("A selected product size is unavailable.");
      if (line.quantity > product.inventoryCount) throw new CommerceValidationError("There is not enough stock for one or more items.");
      const lineTotalKobo = product.priceKobo * line.quantity;
      if (!Number.isSafeInteger(lineTotalKobo) || lineTotalKobo > 2_147_483_647) {
        throw new CommerceValidationError("The order total is outside the supported range.");
      }
      return { line, product, store, lineTotalKobo };
    });

    for (const { line, product } of orderLines) {
      const reserved = await tx.update(sellerProducts).set({
        inventoryCount: sql`${sellerProducts.inventoryCount} - ${line.quantity}`,
        updatedAt: new Date(),
      }).where(and(
        eq(sellerProducts.id, product.id),
        eq(sellerProducts.status, "published"),
        gte(sellerProducts.inventoryCount, line.quantity),
      )).returning({ id: sellerProducts.id });
      if (reserved.length !== 1) throw new CommerceValidationError("Stock changed while you were checking out. Please refresh your cart.");
    }

    let totals: ReturnType<typeof calculateCheckoutAmounts>;
    try {
      totals = calculateCheckoutAmounts(orderLines.map(({ line, product }) => ({
        unitPriceKobo: product.priceKobo,
        quantity: line.quantity,
      })), input.deliveryMethod);
    } catch (error) {
      throw new CommerceValidationError(error instanceof Error ? error.message : "The order total is invalid.");
    }
    const { subtotalKobo, shippingKobo, totalKobo } = totals;

    const now = new Date();
    await tx.insert(customerProfiles).values({
      userId: customerUserId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      address: input.address,
      city: input.city,
    }).onConflictDoUpdate({
      target: customerProfiles.userId,
      set: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        address: input.address,
        city: input.city,
        updatedAt: now,
      },
    });

    const reference = `NK${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`;
    const orderResult = await tx.insert(orders).values({
      reference,
      customerUserId,
      idempotencyKey: input.idempotencyKey,
      idempotencyFingerprint: fingerprint,
      status: "pending_payment",
      currency: "NGN",
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      address: input.address,
      city: input.city,
      deliveryMethod: input.deliveryMethod,
      subtotalKobo,
      shippingKobo,
      totalKobo,
    }).returning();
    const order = orderResult[0]!;
    await tx.insert(orderItems).values(orderLines.map(({ line, product, store, lineTotalKobo }) => ({
      orderId: order.id,
      productId: product.id,
      sellerUserId: product.sellerUserId,
      nameSnapshot: product.name,
      makerSnapshot: store.displayName,
      unitPriceKobo: product.priceKobo,
      quantity: line.quantity,
      size: line.size,
      lineTotalKobo,
    })));
    await tx.insert(paymentTransactions).values({
      orderId: order.id,
      provider: "paystack",
      reference,
      status: "pending",
      amountKobo: totalKobo,
      currency: "NGN",
    });
    await tx.insert(accountAuditEvents).values({
      actorUserId: customerUserId,
      targetUserId: customerUserId,
      eventType: "order_created_pending_payment",
      metadata: { orderReference: reference, lineCount: orderLines.length, totalKobo },
    });
    return { order, paymentReference: reference, authorizationUrl: null, existing: false as const };
    });
  } catch (error) {
    if (!isIdempotencyUniqueViolation(error)) throw error;
    const concurrent = await findExistingPendingCheckout(database, customerUserId, input.idempotencyKey, fingerprint);
    if (!concurrent) throw error;
    return concurrent;
  }
}

export async function getOrderItemsForCheckout(orderId: number) {
  const database = await requireDb();
  return database.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(orderItems.id);
}

export async function savePaystackCheckoutUrl(input: {
  reference: string;
  checkoutUrl: string;
}) {
  const database = await requireDb();
  const result = await database.update(paymentTransactions).set({
    checkoutUrl: input.checkoutUrl,
    updatedAt: new Date(),
  })
    .where(and(eq(paymentTransactions.reference, input.reference), eq(paymentTransactions.status, "pending")))
    .returning({ id: paymentTransactions.id });
  return result.length === 1;
}

export async function listCustomerOrders(customerUserId: number) {
  const database = await requireDb();
  const customerOrders = await database.select({
    order: orders,
    paymentStatus: paymentTransactions.status,
    checkoutUrl: paymentTransactions.checkoutUrl,
  }).from(orders).innerJoin(paymentTransactions, eq(paymentTransactions.orderId, orders.id))
    .where(eq(orders.customerUserId, customerUserId)).orderBy(desc(orders.createdAt)).limit(100);
  if (!customerOrders.length) return [];
  const ids = customerOrders.map(record => record.order.id);
  const items = await database.select().from(orderItems).where(inArray(orderItems.orderId, ids));
  const itemsByOrder = new Map<number, typeof items>();
  for (const item of items) itemsByOrder.set(item.orderId, [...(itemsByOrder.get(item.orderId) ?? []), item]);
  return customerOrders.map(({ order, paymentStatus, checkoutUrl }) => ({
    ...order,
    paymentStatus,
    checkoutUrl: paymentStatus === "pending" ? checkoutUrl : null,
    items: itemsByOrder.get(order.id) ?? [],
  }));
}

export async function getCustomerOrder(customerUserId: number, reference: string) {
  const ordersForUser = await listCustomerOrders(customerUserId);
  return ordersForUser.find(order => order.reference === reference);
}

export async function getPaymentForCustomer(customerUserId: number, reference: string) {
  const database = await requireDb();
  const result = await database.select({ payment: paymentTransactions, order: orders })
    .from(paymentTransactions).innerJoin(orders, eq(paymentTransactions.orderId, orders.id))
    .where(and(eq(paymentTransactions.reference, reference), eq(orders.customerUserId, customerUserId)))
    .limit(1);
  return result[0];
}

export async function getPaymentByReference(reference: string) {
  const database = await requireDb();
  const result = await database.select({ payment: paymentTransactions, order: orders })
    .from(paymentTransactions).innerJoin(orders, eq(paymentTransactions.orderId, orders.id))
    .where(eq(paymentTransactions.reference, reference)).limit(1);
  return result[0];
}

export async function markPaymentSucceeded(input: {
  reference: string;
  amountKobo: number;
  currency: string;
  providerTransactionId?: string;
  actorUserId?: number;
}) {
  const database = await requireDb();
  try {
    return await database.transaction(async tx => {
    const records = await tx.select({ payment: paymentTransactions, order: orders })
      .from(paymentTransactions).innerJoin(orders, eq(paymentTransactions.orderId, orders.id))
      .where(eq(paymentTransactions.reference, input.reference)).limit(1).for("update");
    const record = records[0];
    if (!record) return { success: false as const, reason: "not_found" as const };
    if (record.payment.status === "succeeded" && ["paid", "partially_fulfilled", "fulfilled"].includes(record.order.status)) return { success: true as const, alreadyProcessed: true };
    if (record.payment.status !== "pending" || record.order.status !== "pending_payment") {
      return { success: false as const, reason: "not_pending" as const };
    }
    if (
      input.amountKobo !== record.payment.amountKobo ||
      input.amountKobo !== record.order.totalKobo ||
      input.currency !== record.payment.currency ||
      input.currency !== record.order.currency ||
      input.currency !== "NGN"
    ) {
      return { success: false as const, reason: "amount_mismatch" as const };
    }
    if (input.providerTransactionId) {
      const priorUses = await tx.select({ id: paymentTransactions.id }).from(paymentTransactions)
        .where(eq(paymentTransactions.providerTransactionId, input.providerTransactionId)).limit(1);
      if (priorUses[0] && priorUses[0].id !== record.payment.id) {
        return { success: false as const, reason: "provider_transaction_reused" as const };
      }
    }
    const changed = await tx.update(paymentTransactions).set({
      status: "succeeded",
      providerTransactionId: input.providerTransactionId ?? null,
      verifiedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(paymentTransactions.id, record.payment.id), eq(paymentTransactions.status, "pending")))
      .returning({ id: paymentTransactions.id });
    if (changed.length !== 1) return { success: false as const, reason: "not_pending" as const };
    const orderChanged = await tx.update(orders).set({ status: "paid", updatedAt: new Date() })
      .where(and(eq(orders.id, record.order.id), eq(orders.status, "pending_payment")))
      .returning({ id: orders.id });
    if (orderChanged.length !== 1) throw new Error("Payment succeeded but the order status transition failed.");
    await tx.insert(accountAuditEvents).values({
      actorUserId: input.actorUserId ?? null,
      targetUserId: record.order.customerUserId,
      eventType: "payment_verified",
      metadata: {
        orderReference: record.order.reference,
        provider: "paystack",
        paymentReference: record.payment.reference,
        source: input.actorUserId ? "admin_reconciliation" : "provider_verification",
      },
    });
    return { success: true as const, alreadyProcessed: false };
    });
  } catch (error) {
    if (hasPostgresConstraint(error, "paymentTransactions_providerTransactionId_unique")) {
      return { success: false as const, reason: "provider_transaction_reused" as const };
    }
    throw error;
  }
}

export async function markPaymentFailed(reference: string, actorUserId?: number) {
  const database = await requireDb();
  return database.transaction(async tx => {
    const records = await tx.select({ payment: paymentTransactions, order: orders })
      .from(paymentTransactions).innerJoin(orders, eq(paymentTransactions.orderId, orders.id))
      .where(eq(paymentTransactions.reference, reference)).limit(1).for("update");
    const record = records[0];
    if (!record || record.payment.status !== "pending" || record.order.status !== "pending_payment") return false;
    const changed = await tx.update(paymentTransactions).set({ status: "failed", updatedAt: new Date() })
      .where(and(eq(paymentTransactions.id, record.payment.id), eq(paymentTransactions.status, "pending")))
      .returning({ id: paymentTransactions.id });
    if (changed.length !== 1) return false;
    const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, record.order.id));
    for (const line of lines) {
      if (line.productId) {
        await tx.update(sellerProducts).set({
          inventoryCount: sql`${sellerProducts.inventoryCount} + ${line.quantity}`,
          updatedAt: new Date(),
        }).where(eq(sellerProducts.id, line.productId));
      }
    }
    const orderChanged = await tx.update(orders).set({ status: "payment_failed", updatedAt: new Date() })
      .where(and(eq(orders.id, record.order.id), eq(orders.status, "pending_payment")))
      .returning({ id: orders.id });
    if (orderChanged.length !== 1) throw new Error("Payment failure could not be applied to the pending order.");
    await tx.insert(accountAuditEvents).values({
      actorUserId: actorUserId ?? null,
      targetUserId: record.order.customerUserId,
      eventType: "payment_failed_stock_released",
      metadata: {
        orderReference: record.order.reference,
        provider: "paystack",
        source: actorUserId ? "admin_reconciliation" : "provider_verification",
      },
    });
    return true;
  });
}

export async function listOrdersForSeller(sellerUserId: number) {
  const database = await requireDb();
  return database.select({
    order: {
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
      firstName: orders.firstName,
      lastName: orders.lastName,
      phone: orders.phone,
      address: orders.address,
      city: orders.city,
      deliveryMethod: orders.deliveryMethod,
      createdAt: orders.createdAt,
    },
    item: orderItems,
  })
    .from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(
      eq(orderItems.sellerUserId, sellerUserId),
      inArray(orders.status, ["paid", "partially_fulfilled", "fulfilled"]),
    ))
    .orderBy(desc(orders.createdAt)).limit(200);
}

export async function updateSellerOrderItemFulfillment(input: {
  sellerUserId: number;
  orderItemId: number;
  status: FulfillmentStatus;
  carrier?: string | null;
  trackingNumber?: string | null;
}) {
  const database = await requireDb();
  return database.transaction(async tx => {
    const records = await tx.select({ item: orderItems, order: orders })
      .from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(
        eq(orderItems.id, input.orderItemId),
        eq(orderItems.sellerUserId, input.sellerUserId),
      )).limit(1).for("update");
    const record = records[0];
    if (!record) return { success: false as const, reason: "not_found" as const };
    if (!["paid", "partially_fulfilled", "fulfilled"].includes(record.order.status)) {
      return { success: false as const, reason: "order_not_fulfillable" as const };
    }
    if (!canTransitionFulfillment(record.item.fulfillmentStatus, input.status)) {
      return { success: false as const, reason: "invalid_transition" as const };
    }

    const now = new Date();
    const update: Partial<typeof orderItems.$inferInsert> = {
      fulfillmentStatus: input.status,
      updatedAt: now,
      ...(input.carrier === undefined ? {} : { carrier: input.carrier }),
      ...(input.trackingNumber === undefined ? {} : { trackingNumber: input.trackingNumber }),
      ...(input.status === "fulfilled" ? { fulfilledAt: record.item.fulfilledAt ?? now } : {}),
    };
    const changedItems = await tx.update(orderItems).set(update)
      .where(and(
        eq(orderItems.id, input.orderItemId),
        eq(orderItems.sellerUserId, input.sellerUserId),
      )).returning();
    const updatedItem = changedItems[0];
    if (!updatedItem) throw new Error("Seller fulfillment update lost its item lock.");

    const siblingItems = await tx.select({ id: orderItems.id, status: orderItems.fulfillmentStatus })
      .from(orderItems).where(eq(orderItems.orderId, record.order.id));
    const statuses = siblingItems.map(item => item.id === updatedItem.id ? updatedItem.fulfillmentStatus : item.status);
    const nextOrderStatus = deriveFulfillmentOrderStatus(statuses);
    if (nextOrderStatus !== record.order.status) {
      const changedOrder = await tx.update(orders).set({ status: nextOrderStatus, updatedAt: now })
        .where(and(
          eq(orders.id, record.order.id),
          inArray(orders.status, ["paid", "partially_fulfilled", "fulfilled"]),
        )).returning({ id: orders.id });
      if (changedOrder.length !== 1) throw new Error("Order fulfillment status changed concurrently.");
    }
    await tx.insert(accountAuditEvents).values({
      actorUserId: input.sellerUserId,
      targetUserId: record.order.customerUserId,
      eventType: "seller_order_item_fulfillment_updated",
      metadata: {
        orderReference: record.order.reference,
        orderItemId: updatedItem.id,
        fulfillmentStatus: input.status,
        carrier: updatedItem.carrier,
        trackingNumber: updatedItem.trackingNumber,
      },
    });
    return { success: true as const, item: updatedItem, orderStatus: nextOrderStatus };
  });
}
