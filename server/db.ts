import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, gt, ilike, inArray, isNull, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  accountAuditEvents,
  adminBootstrap,
  customerProfiles,
  orders,
  orderItems,
  paymentTransactions,
  sellerProductImages,
  sellerApplications,
  sellerProducts,
  sellerStores,
  userNotifications,
  users,
  type AccountRole,
  type DeliveryMethod,
  type InsertUser,
  type SellerApplicationStatus,
  productStatuses,
} from "../drizzle/schema";
import { canBootstrapInitialAdmin, canTransitionSellerApplication } from "./_core/authorization";
import { decideSellerActivation } from "./commerce/seller-activation";
import { ENV } from "./_core/env";
import { canTransitionFulfillment, deriveFulfillmentOrderStatus, type FulfillmentStatus } from "./commerce/fulfillment";
import { checkoutFingerprint } from "./commerce/idempotency";
import { calculateCheckoutAmounts } from "./commerce/pricing";
import { hasPrimaryProductImage, MAX_PRODUCT_IMAGES_PER_LISTING } from "./commerce/product-upload";
import { notificationEventKey } from "./commerce/notifications";

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

function redactAuditMetadata(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;
  const blocked = /token|secret|password|authorization|checkouturl|providerresponse|apikey/i;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (blocked.test(key)) return [key, "[redacted]"];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) return [key, redactAuditMetadata(entry as Record<string, unknown>)];
    return [key, entry];
  }));
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

export async function listProductsForAdmin(input: {
  afterId?: string;
  limit?: number;
  search?: string;
  status?: typeof productStatuses[number];
} = {}) {
  const database = await requireDb();
  const limit = Math.max(1, Math.min(input.limit ?? 40, 100));
  const search = input.search?.trim();
  const rows = await database.select({
    id: sellerProducts.id,
    name: sellerProducts.name,
    category: sellerProducts.category,
    priceKobo: sellerProducts.priceKobo,
    inventoryCount: sellerProducts.inventoryCount,
    status: sellerProducts.status,
    createdAt: sellerProducts.createdAt,
    updatedAt: sellerProducts.updatedAt,
    sellerUserId: sellerProducts.sellerUserId,
    sellerName: users.name,
    sellerEmail: users.email,
    storeName: sellerStores.displayName,
    storeCity: sellerStores.city,
    storeActive: sellerStores.isActive,
    imageCount: sql<number>`(select count(*)::int from ${sellerProductImages} as spi where spi."productId" = ${sellerProducts.id})`,
    primaryImageCount: sql<number>`(select count(*)::int from ${sellerProductImages} as spi where spi."productId" = ${sellerProducts.id} and spi."isPrimary" = true)`,
  }).from(sellerProducts)
    .innerJoin(users, eq(users.id, sellerProducts.sellerUserId))
    .leftJoin(sellerStores, eq(sellerStores.userId, sellerProducts.sellerUserId))
    .where(and(
      ...(input.afterId === undefined ? [] : [lt(sellerProducts.id, input.afterId)]),
      ...(input.status ? [eq(sellerProducts.status, input.status)] : []),
      ...(search ? [ilike(sellerProducts.name, `%${search}%`)] : []),
    ))
    .orderBy(desc(sellerProducts.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}

export async function listAuditEventsForAdmin(input: {
  afterId?: number;
  limit?: number;
  eventType?: string;
} = {}) {
  const database = await requireDb();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const rows = await database.select({
    id: accountAuditEvents.id,
    eventType: accountAuditEvents.eventType,
    metadata: accountAuditEvents.metadata,
    createdAt: accountAuditEvents.createdAt,
    actorUserId: accountAuditEvents.actorUserId,
    actorName: users.name,
    actorEmail: users.email,
    targetUserId: accountAuditEvents.targetUserId,
  }).from(accountAuditEvents)
    .leftJoin(users, eq(users.id, accountAuditEvents.actorUserId))
    .where(and(
      ...(input.afterId === undefined ? [] : [lt(accountAuditEvents.id, input.afterId)]),
      ...(input.eventType ? [eq(accountAuditEvents.eventType, input.eventType)] : []),
    ))
    .orderBy(desc(accountAuditEvents.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(row => ({ ...row, metadata: redactAuditMetadata(row.metadata) }));
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
  return database.transaction(async tx => {
    const inserted = await tx.insert(sellerApplications).values({ userId, ...input, status: "pending" }).returning();
    const application = inserted[0];
    if (!application) throw new Error("Seller application could not be created.");
    await tx.insert(accountAuditEvents).values({
      actorUserId: userId,
      targetUserId: userId,
      eventType: "seller_application_submitted",
      metadata: { applicationId: application.id },
    });
    const staffUsers = await tx.select({ id: users.id }).from(users).where(inArray(users.role, ["staff", "admin"]));
    await tx.insert(userNotifications).values([
      ...staffUsers.map(staff => ({
        recipientUserId: staff.id,
        eventKey: notificationEventKey("seller-application", application.id, "submitted"),
        category: "seller_application" as const,
        title: "New seller application",
        message: `${application.businessName} submitted a seller application for review.`,
        href: "/staff",
      })),
      {
        recipientUserId: userId,
        eventKey: notificationEventKey("seller-application", application.id, "received"),
        category: "seller_application" as const,
        title: "Seller application received",
        message: "Your application is in review. We will notify you when the partnerships team records a decision.",
        href: "/account",
      },
    ]).onConflictDoNothing();
    return application;
  });
}

const SELF_SERVICE_SELLER_NOTE = "Self-service activation; no application review or personal/business details were required.";

function defaultSelfServiceStoreName(profileName: string | null) {
  const name = profileName?.trim();
  return name ? `${name.slice(0, 151)}'s Store` : `NaijaKoblas Store ${randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function activateSellerAccount(userId: number) {
  const database = await requireDb();
  return database.transaction(async tx => {
    const accountRows = await tx.select({ id: users.id, role: users.role, name: users.name, email: users.email })
      .from(users).where(eq(users.id, userId)).limit(1).for("update");
    const account = accountRows[0];
    if (!account) throw new CommerceValidationError("Your account could not be found. Please sign in again.");
    if (!account.email) throw new CommerceValidationError("A verified email is required before seller access can be activated.");

    const applicationRows = await tx.select().from(sellerApplications)
      .where(eq(sellerApplications.userId, userId)).limit(1).for("update");
    const application = applicationRows[0] ?? null;
    const storeRows = await tx.select().from(sellerStores)
      .where(eq(sellerStores.userId, userId)).limit(1).for("update");
    const existingStore = storeRows[0] ?? null;
    const plan = decideSellerActivation({
      role: account.role,
      applicationStatus: application?.status ?? null,
      storeExists: Boolean(existingStore),
      storeActive: existingStore?.isActive ?? false,
    });

    if (plan.kind === "already_active") return { status: "already_active" as const, store: existingStore!, application };
    if (plan.kind === "blocked") {
      const message = plan.reason === "rejected_application"
        ? "Seller access was previously declined. Contact NaijaKoblas support if you believe this is an error."
        : plan.reason === "suspended_application"
          ? "Seller access is currently paused. Contact NaijaKoblas support to request reinstatement."
          : plan.reason === "inactive_store"
            ? "This seller store is inactive. Contact NaijaKoblas support before trying to reactivate it."
          : plan.reason === "missing_store"
            ? "Your seller account is missing its store record. Contact NaijaKoblas support."
            : plan.reason === "missing_application"
              ? "Your seller account is missing its application record. Contact NaijaKoblas support."
              : "This account role cannot be replaced with seller access.";
      throw new CommerceValidationError(message);
    }

    const now = new Date();
    const displayName = existingStore?.displayName
      ?? application?.businessName
      ?? defaultSelfServiceStoreName(account.name);
    const city = existingStore?.city ?? application?.city ?? "Nigeria";
    let activeApplication = application;

    if (activeApplication?.status === "pending") {
      const updated = await tx.update(sellerApplications).set({
        status: "approved",
        reviewNote: SELF_SERVICE_SELLER_NOTE,
        reviewedByUserId: null,
        reviewedAt: null,
        updatedAt: now,
      }).where(and(
        eq(sellerApplications.id, activeApplication.id),
        eq(sellerApplications.status, "pending"),
      )).returning();
      activeApplication = updated[0] ?? null;
      if (!activeApplication) throw new CommerceValidationError("Your seller request changed. Refresh your account and try again.");
    }

    if (!activeApplication) {
      const legalName = account.name?.trim().slice(0, 160) || "Not provided";
      const inserted = await tx.insert(sellerApplications).values({
        userId,
        legalName,
        email: account.email,
        businessName: displayName,
        craftSummary: "Self-service seller account. You can add product details and complete your store profile later.",
        phone: "Not provided",
        city,
        status: "approved",
        reviewNote: SELF_SERVICE_SELLER_NOTE,
      }).returning();
      activeApplication = inserted[0] ?? null;
      if (!activeApplication) throw new Error("Seller access could not be activated.");
    }

    let store = existingStore;
    if (store) {
      const updated = await tx.update(sellerStores).set({ isActive: true, updatedAt: now })
        .where(eq(sellerStores.userId, userId)).returning();
      store = updated[0] ?? null;
    } else {
      const inserted = await tx.insert(sellerStores).values({
        userId,
        displayName,
        city,
        description: "Self-service seller store. Add products from your seller workspace and update these details whenever you are ready.",
        isActive: true,
      }).returning();
      store = inserted[0] ?? null;
    }
    if (!store) throw new Error("Seller store could not be created.");

    await tx.update(users).set({ role: "seller", updatedAt: now }).where(eq(users.id, userId));
    await tx.insert(accountAuditEvents).values({
      actorUserId: userId,
      targetUserId: userId,
      eventType: "seller_self_activated",
      metadata: { applicationId: activeApplication.id, storeId: store.id, activationMethod: "one_click" },
    });

    const staffUsers = await tx.select({ id: users.id }).from(users).where(inArray(users.role, ["staff", "admin"]));
    await tx.insert(userNotifications).values([
      ...staffUsers.map(staff => ({
        recipientUserId: staff.id,
        eventKey: notificationEventKey("seller-self-activation", userId, "staff"),
        category: "seller_application",
        title: "A seller joined NaijaKoblas",
        message: `${displayName} activated seller access directly. Their store profile can be completed later.`,
        href: "/staff",
      })),
      {
        recipientUserId: userId,
        eventKey: notificationEventKey("seller-self-activation", userId, "seller"),
        category: "seller_application",
        title: "Your seller workspace is ready",
        message: "Seller access is active. You can update your store profile and add listings whenever you are ready.",
        href: "/seller",
      },
    ]).onConflictDoNothing();

    return { status: "activated" as const, store, application: activeApplication };
  });
}

export async function updateSellerStoreProfile(userId: number, input: {
  displayName: string;
  city: string;
  description?: string;
}) {
  const database = await requireDb();
  return database.transaction(async tx => {
    const accountRows = await tx.select({ id: users.id, role: users.role }).from(users)
      .where(eq(users.id, userId)).limit(1).for("update");
    if (accountRows[0]?.role !== "seller") throw new CommerceValidationError("Only active sellers can update a store profile.");
    const storeRows = await tx.select().from(sellerStores).where(eq(sellerStores.userId, userId)).limit(1).for("update");
    const store = storeRows[0];
    if (!store?.isActive) throw new CommerceValidationError("This seller store is not active.");
    const applicationRows = await tx.select({ id: sellerApplications.id, status: sellerApplications.status })
      .from(sellerApplications).where(eq(sellerApplications.userId, userId)).limit(1).for("update");
    const application = applicationRows[0];
    if (application && application.status !== "approved") throw new CommerceValidationError("Seller access is not active.");

    const updatedAt = new Date();
    const updated = await tx.update(sellerStores).set({
      displayName: input.displayName,
      city: input.city,
      description: input.description?.trim() || null,
      updatedAt,
    }).where(eq(sellerStores.userId, userId)).returning();
    if (application) {
      await tx.update(sellerApplications).set({ businessName: input.displayName, city: input.city, updatedAt })
        .where(eq(sellerApplications.id, application.id));
    }
    await tx.insert(accountAuditEvents).values({
      actorUserId: userId,
      targetUserId: userId,
      eventType: "seller_store_profile_updated",
      metadata: { storeId: store.id },
    });
    return updated[0]!;
  });
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
    const applicationRefs = await tx.select({ id: sellerApplications.id, userId: sellerApplications.userId })
      .from(sellerApplications)
      .where(eq(sellerApplications.id, input.applicationId)).limit(1);
    const applicationRef = applicationRefs[0];
    if (!applicationRef) return { success: false as const, reason: "not_found" as const };
    const applicants = await tx.select().from(users).where(eq(users.id, applicationRef.userId)).limit(1).for("update");
    const applicant = applicants[0];
    if (!applicant) return { success: false as const, reason: "account_missing" as const };
    if (applicant.role === "staff" || applicant.role === "admin") {
      return { success: false as const, reason: "privileged_account" as const };
    }
    const applications = await tx.select().from(sellerApplications)
      .where(eq(sellerApplications.id, input.applicationId)).limit(1).for("update");
    const application = applications[0];
    if (!application) return { success: false as const, reason: "not_found" as const };
    if (!canTransitionSellerApplication(application.status, input.status)) {
      return { success: false as const, reason: "invalid_transition" as const };
    }
    const updatedAt = new Date();
    const updated = await tx.update(sellerApplications).set({
      status: input.status,
      reviewNote: input.reviewNote || null,
      reviewedByUserId: input.reviewerUserId,
      reviewedAt: updatedAt,
      updatedAt,
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
    await tx.insert(userNotifications).values({
      recipientUserId: application.userId,
      eventKey: notificationEventKey("seller-application", application.id, "status", input.status, updatedAt.getTime()),
      category: "seller_application",
      title: input.status === "approved" ? "Seller application approved" : input.status === "suspended" ? "Seller access paused" : "Seller application update",
      message: input.status === "approved"
        ? "Your seller application was approved. Your seller workspace is ready."
        : input.status === "suspended"
          ? "Seller access is paused. Existing paid order fulfillment remains available."
          : "Your seller application was not approved. Contact the partnerships team for next steps.",
      href: input.status === "approved" ? "/seller" : "/account",
    }).onConflictDoNothing();
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
    await tx.insert(userNotifications).values({
      recipientUserId: input.targetUserId,
      eventKey: notificationEventKey("account", input.targetUserId, "role", nextRole, result[0]!.updatedAt.getTime()),
      category: "account",
      title: nextRole === "staff" ? "Staff access granted" : "Staff access changed",
      message: nextRole === "staff"
        ? "An administrator granted your account access to the staff review workspace."
        : "An administrator removed staff workspace access from your account.",
      href: nextRole === "staff" ? "/staff" : "/account",
    }).onConflictDoNothing();
    return { success: true as const, user: result[0]! };
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
  sizes: string[];
  inventoryCount: number;
};

async function listGalleryImages(database: Database, productIds: string[]) {
  if (productIds.length === 0) return new Map<string, Array<{
    id: number;
    url: string;
    caption: string | null;
    displayOrder: number;
    isPrimary: boolean;
    width: number | null;
    height: number | null;
    format: string;
  }>>();
  const rows = await database.select({
    id: sellerProductImages.id,
    productId: sellerProductImages.productId,
    url: sellerProductImages.url,
    caption: sellerProductImages.caption,
    displayOrder: sellerProductImages.displayOrder,
    isPrimary: sellerProductImages.isPrimary,
    width: sellerProductImages.width,
    height: sellerProductImages.height,
    format: sellerProductImages.format,
  }).from(sellerProductImages).where(inArray(sellerProductImages.productId, productIds))
    .orderBy(asc(sellerProductImages.displayOrder), asc(sellerProductImages.id));
  const grouped = new Map<string, typeof rows>();
  for (const image of rows) grouped.set(image.productId, [...(grouped.get(image.productId) ?? []), image]);
  return grouped;
}

export async function listSellerProducts(sellerUserId: number) {
  const database = await requireDb();
  const products = await database.select().from(sellerProducts).where(eq(sellerProducts.sellerUserId, sellerUserId))
    .orderBy(desc(sellerProducts.updatedAt)).limit(100);
  const gallery = await listGalleryImages(database, products.map(product => product.id));
  return products.map(product => ({ ...product, images: gallery.get(product.id) ?? [] }));
}

export async function createSellerProduct(sellerUserId: number, input: SellerProductInput) {
  const database = await requireDb();
  const id = `prod_${randomUUID().replaceAll("-", "")}`;
  const result = await database.insert(sellerProducts).values({
    id,
    sellerUserId,
    ...input,
    imageUrl: null,
    status: "draft",
  }).returning();
  return result[0]!;
}

export async function listActiveSellersForStaff() {
  const database = await requireDb();
  return database.select({
    userId: users.id,
    businessName: sellerApplications.businessName,
    displayName: sellerStores.displayName,
    city: sellerStores.city,
  }).from(users)
    .innerJoin(sellerApplications, eq(sellerApplications.userId, users.id))
    .innerJoin(sellerStores, eq(sellerStores.userId, users.id))
    .where(and(
      eq(users.role, "seller"),
      eq(sellerApplications.status, "approved"),
      eq(sellerStores.isActive, true),
    )).orderBy(asc(sellerStores.displayName)).limit(200);
}

export async function createProductForStaff(input: {
  actorUserId: number;
  sellerUserId: number;
  product: SellerProductInput;
}) {
  const database = await requireDb();
  return database.transaction(async tx => {
    const seller = await tx.select({ userId: users.id })
      .from(users)
      .innerJoin(sellerApplications, eq(sellerApplications.userId, users.id))
      .innerJoin(sellerStores, eq(sellerStores.userId, users.id))
      .where(and(
        eq(users.id, input.sellerUserId),
        eq(users.role, "seller"),
        eq(sellerApplications.status, "approved"),
        eq(sellerStores.isActive, true),
      )).limit(1).for("update");
    if (!seller[0]) throw new CommerceValidationError("Choose an approved seller with an active store.");

    const id = `prod_${randomUUID().replaceAll("-", "")}`;
    const created = await tx.insert(sellerProducts).values({
      id,
      sellerUserId: input.sellerUserId,
      ...input.product,
      imageUrl: null,
      status: "draft",
    }).returning();
    await tx.insert(accountAuditEvents).values({
      actorUserId: input.actorUserId,
      targetUserId: input.sellerUserId,
      eventType: "staff_created_seller_product_draft",
      metadata: { productId: id },
    });
    await tx.insert(userNotifications).values({
      recipientUserId: input.sellerUserId,
      eventKey: `product:${id}:staff-draft-created`,
      category: "listing",
      title: "A draft listing is ready for your review",
      message: "A staff member added a draft listing to your store. Review its details and publish it from your seller workspace.",
      href: "/seller",
    }).onConflictDoNothing();
    return created[0]!;
  });
}

export async function getSellerStoreByUserId(userId: number) {
  const database = await getDb();
  if (!database) return undefined;
  const result = await database.select().from(sellerStores).where(eq(sellerStores.userId, userId)).limit(1);
  return result[0];
}

export async function getProductUploadTarget(productId: string) {
  const database = await getDb();
  if (!database) return undefined;
  const rows = await database.select({
    product: sellerProducts,
    sellerRole: users.role,
    applicationStatus: sellerApplications.status,
    storeActive: sellerStores.isActive,
  }).from(sellerProducts)
    .innerJoin(users, eq(users.id, sellerProducts.sellerUserId))
    .leftJoin(sellerApplications, eq(sellerApplications.userId, users.id))
    .leftJoin(sellerStores, eq(sellerStores.userId, users.id))
    .where(eq(sellerProducts.id, productId)).limit(1);
  return rows[0];
}

export type NewProductImage = {
  url: string;
  publicId: string;
  assetId: string | null;
  width: number;
  height: number;
  format: "jpg" | "png" | "webp";
};

export async function addSellerProductImages(input: {
  actorUserId: number;
  sellerUserId: number;
  productId: string;
  images: NewProductImage[];
}) {
  if (!input.images.length) throw new CommerceValidationError("Select at least one product image.");
  const database = await requireDb();
  return database.transaction(async tx => {
    const actorRows = await tx.select({ id: users.id, role: users.role }).from(users)
      .where(eq(users.id, input.actorUserId)).limit(1).for("update");
    const actor = actorRows[0];
    const isSellerOwner = actor?.role === "seller" && actor.id === input.sellerUserId;
    const isMarketplaceStaff = actor?.role === "staff" || actor?.role === "admin";
    if (!isSellerOwner && !isMarketplaceStaff) throw new CommerceValidationError("The current account cannot upload seller product images.");

    const sellerRows = await tx.select({ role: users.role, status: sellerApplications.status, storeActive: sellerStores.isActive })
      .from(users).innerJoin(sellerApplications, eq(sellerApplications.userId, users.id))
      .innerJoin(sellerStores, eq(sellerStores.userId, users.id))
      .where(eq(users.id, input.sellerUserId)).limit(1).for("update");
    const seller = sellerRows[0];
    if (seller?.role !== "seller" || seller.status !== "approved" || !seller.storeActive) {
      throw new CommerceValidationError("Product images can only be added to an approved seller with an active store.");
    }

    const productRows = await tx.select().from(sellerProducts).where(and(
      eq(sellerProducts.id, input.productId),
      eq(sellerProducts.sellerUserId, input.sellerUserId),
    )).limit(1).for("update");
    const product = productRows[0];
    if (!product) throw new CommerceValidationError("The product listing is not owned by the selected seller.");

    const existing = await tx.select({ id: sellerProductImages.id, isPrimary: sellerProductImages.isPrimary })
      .from(sellerProductImages).where(eq(sellerProductImages.productId, input.productId));
    if (existing.length + input.images.length > MAX_PRODUCT_IMAGES_PER_LISTING) {
      throw new CommerceValidationError(`A listing can contain at most ${MAX_PRODUCT_IMAGES_PER_LISTING} images.`);
    }
    const chooseFirstAsPrimary = !existing.some(image => image.isPrimary);
    const now = new Date();
    const values = input.images.map((image, index) => ({
      productId: input.productId,
      createdByUserId: input.actorUserId,
      ...image,
      displayOrder: existing.length + index,
      isPrimary: chooseFirstAsPrimary && index === 0,
      createdAt: now,
    }));
    const inserted = await tx.insert(sellerProductImages).values(values).returning({
      id: sellerProductImages.id,
      url: sellerProductImages.url,
      caption: sellerProductImages.caption,
      displayOrder: sellerProductImages.displayOrder,
      isPrimary: sellerProductImages.isPrimary,
      width: sellerProductImages.width,
      height: sellerProductImages.height,
      format: sellerProductImages.format,
    });
    if (chooseFirstAsPrimary && inserted[0]) {
      await tx.update(sellerProducts).set({ imageUrl: inserted[0].url, updatedAt: now })
        .where(and(eq(sellerProducts.id, input.productId), eq(sellerProducts.sellerUserId, input.sellerUserId)));
    }
    if (input.actorUserId !== input.sellerUserId) {
      await tx.insert(accountAuditEvents).values({
        actorUserId: input.actorUserId,
        targetUserId: input.sellerUserId,
        eventType: "staff_uploaded_seller_product_images",
        metadata: { productId: input.productId, imageCount: inserted.length },
      });
      await tx.insert(userNotifications).values({
        recipientUserId: input.sellerUserId,
        eventKey: notificationEventKey("product", input.productId, "staff-images", inserted[0]!.id),
        category: "listing",
        title: "Product photos were added to your draft",
        message: "A staff member uploaded photos for your listing. Review the draft in your seller workspace before publishing it.",
        href: "/seller",
      }).onConflictDoNothing();
    }
    return inserted;
  });
}

export async function setSellerProductPrimaryImage(input: { sellerUserId: number; productId: string; imageId: number }) {
  const database = await requireDb();
  return database.transaction(async tx => {
    const products = await tx.select({ id: sellerProducts.id }).from(sellerProducts).where(and(
      eq(sellerProducts.id, input.productId),
      eq(sellerProducts.sellerUserId, input.sellerUserId),
    )).limit(1).for("update");
    if (!products[0]) return undefined;
    const images = await tx.select().from(sellerProductImages).where(and(
      eq(sellerProductImages.id, input.imageId),
      eq(sellerProductImages.productId, input.productId),
    )).limit(1);
    const image = images[0];
    if (!image) return undefined;
    await tx.update(sellerProductImages).set({ isPrimary: false }).where(eq(sellerProductImages.productId, input.productId));
    await tx.update(sellerProductImages).set({ isPrimary: true }).where(and(
      eq(sellerProductImages.id, input.imageId),
      eq(sellerProductImages.productId, input.productId),
    ));
    await tx.update(sellerProducts).set({ imageUrl: image.url, updatedAt: new Date() }).where(and(
      eq(sellerProducts.id, input.productId),
      eq(sellerProducts.sellerUserId, input.sellerUserId),
    ));
    return { ...image, isPrimary: true };
  });
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
      const primaryImages = await tx.select({ isPrimary: sellerProductImages.isPrimary })
        .from(sellerProductImages)
        .where(and(eq(sellerProductImages.productId, input.productId), eq(sellerProductImages.isPrimary, true)))
        .limit(1);
      if (!hasPrimaryProductImage(primaryImages)) {
        throw new CommerceValidationError("Add and select a primary product photo before publishing this listing.");
      }
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
  const products = await database.select({
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
  const gallery = await listGalleryImages(database, products.map(product => product.id));
  return products.map(product => ({
    ...product,
    images: (gallery.get(product.id) ?? []).map(image => image.url),
  }));
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
    const orderLines = await tx.select({ sellerUserId: orderItems.sellerUserId }).from(orderItems)
      .where(eq(orderItems.orderId, record.order.id));
    const sellerUserIds = [...new Set(orderLines.map(line => line.sellerUserId))];
    await tx.insert(userNotifications).values([
      {
        recipientUserId: record.order.customerUserId,
        eventKey: notificationEventKey("order", record.order.id, "paid", "customer"),
        category: "payment",
        title: "Payment confirmed",
        message: `Payment for order ${record.order.reference} is confirmed. You can review the order in your account.`,
        href: "/account",
      },
      ...sellerUserIds.map(sellerUserId => ({
        recipientUserId: sellerUserId,
        eventKey: notificationEventKey("order", record.order.id, "paid", "seller", sellerUserId),
        category: "order",
        title: "A customer order is ready",
        message: `Order ${record.order.reference} is paid and has items assigned to your store.`,
        href: "/seller",
      })),
    ]).onConflictDoNothing();
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
    await tx.insert(userNotifications).values({
      recipientUserId: record.order.customerUserId,
      eventKey: notificationEventKey("order", record.order.id, "payment-failed"),
      category: "payment",
      title: "Payment was not completed",
      message: `Payment for order ${record.order.reference} was verified as unsuccessful and reserved stock was released.`,
      href: "/account",
    }).onConflictDoNothing();
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
    await tx.insert(userNotifications).values({
      recipientUserId: record.order.customerUserId,
      eventKey: notificationEventKey("order", record.order.id, "item", updatedItem.id, "fulfillment", input.status),
      category: "fulfillment",
      title: "Order fulfillment updated",
      message: `${updatedItem.nameSnapshot} is now marked ${input.status.replaceAll("_", " ")}.`,
      href: "/account",
    }).onConflictDoNothing();
    return { success: true as const, item: updatedItem, orderStatus: nextOrderStatus };
  });
}


export async function listUserNotifications(userId: number) {
  const database = await requireDb();
  const [items, unreadRows] = await Promise.all([
    database.select({
      id: userNotifications.id,
      category: userNotifications.category,
      title: userNotifications.title,
      message: userNotifications.message,
      href: userNotifications.href,
      readAt: userNotifications.readAt,
      createdAt: userNotifications.createdAt,
    }).from(userNotifications).where(eq(userNotifications.recipientUserId, userId))
      .orderBy(desc(userNotifications.createdAt), desc(userNotifications.id)).limit(50),
    database.select({ count: sql<number>`count(*)` }).from(userNotifications)
      .where(and(eq(userNotifications.recipientUserId, userId), isNull(userNotifications.readAt))),
  ]);
  return { items, unreadCount: Number(unreadRows[0]?.count ?? 0) };
}

export async function markUserNotificationRead(userId: number, notificationId: number) {
  const database = await requireDb();
  const changed = await database.update(userNotifications).set({ readAt: new Date() }).where(and(
    eq(userNotifications.id, notificationId),
    eq(userNotifications.recipientUserId, userId),
    isNull(userNotifications.readAt),
  )).returning({ id: userNotifications.id });
  return changed.length === 1;
}

export async function markAllUserNotificationsRead(userId: number) {
  const database = await requireDb();
  const changed = await database.update(userNotifications).set({ readAt: new Date() }).where(and(
    eq(userNotifications.recipientUserId, userId),
    isNull(userNotifications.readAt),
  )).returning({ id: userNotifications.id });
  return changed.length;
}
