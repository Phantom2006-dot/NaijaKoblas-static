import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  accountAuditEvents,
  orderItems,
  orders,
  sellerApplications,
  sellerProductImages,
  sellerProducts,
  sellerStores,
  userNotifications,
  users,
  productStatuses,
} from "../../drizzle/schema";
import { notificationEventKey } from "../commerce/notifications";
import { getDb } from "../db";
import { adminProcedure, router } from "../_core/trpc";

const MAX_OFFSET = 100_000;
const MAX_PAGE_SIZE = 100;
const LOW_STOCK_THRESHOLD = 5;
const MAX_PRICE_KOBO = 2_147_483_647;
const KOBO_FLOAT_TOLERANCE = 1e-7;

const priceNaira = z.number().finite().positive().max(MAX_PRICE_KOBO / 100).refine(
  value => {
    const kobo = Math.round(value * 100);
    return Number.isSafeInteger(kobo)
      && kobo <= MAX_PRICE_KOBO
      && Math.abs(value * 100 - kobo) < KOBO_FLOAT_TOLERANCE;
  },
  "Price must resolve to a safe integer number of kobo.",
);

const productFields = {
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().min(20).max(5_000),
  category: z.string().trim().min(2).max(80),
  priceNaira,
  sizes: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
  inventoryCount: z.number().int().min(0).max(1_000_000),
};

export const adminProductListInput = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  status: z.enum(productStatuses).optional(),
  stock: z.enum(["all", "in_stock", "out_of_stock", "low_stock"] as const).default("all"),
  sort: z.enum(["name", "price", "date"] as const).default("date"),
  direction: z.enum(["asc", "desc"] as const).default("desc"),
  offset: z.number().int().min(0).max(MAX_OFFSET).default(0),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(40),
}).strict();

export const adminProductCreateInput = z.object({
  sellerUserId: z.number().int().positive(),
  product: z.object(productFields).strict(),
}).strict();

const productStatusChange = z.enum(["draft", "published", "archived"] as const);
export const adminProductUpdateInput = z.object({
  productId: z.string().trim().min(1).max(64),
  expectedUpdatedAt: z.coerce.date(),
  changes: z.object({
    name: productFields.name,
    description: productFields.description,
    category: productFields.category,
    priceNaira: productFields.priceNaira,
    sizes: productFields.sizes,
    inventoryCount: productFields.inventoryCount,
    status: productStatusChange,
  }).partial().refine(changes => Object.keys(changes).length > 0, "At least one product change is required.").strict(),
}).strict();

export const adminProductDeleteInput = z.object({
  productId: z.string().trim().min(1).max(64),
  confirmationName: z.string().trim().min(1).max(180),
}).strict();

export const adminProductImageInput = z.object({
  productId: z.string().trim().min(1).max(64),
  imageId: z.number().int().positive(),
}).strict();

export const adminProductRemoveImageInput = adminProductImageInput.extend({
  confirm: z.literal(true),
}).strict();

export const adminProductImageEditInput = z.object({
  productId: z.string().trim().min(1).max(64),
  imageId: z.number().int().positive(),
  caption: z.string().trim().max(240).nullable().optional(),
  displayOrder: z.number().int().min(0).max(9).optional(),
}).strict().refine(input => input.caption !== undefined || input.displayOrder !== undefined, "Provide a caption or display order change.");

export type AdminProductListInput = z.input<typeof adminProductListInput>;
export type AdminProductUpdateInput = z.input<typeof adminProductUpdateInput>;

function toKobo(value: number) {
  const kobo = Math.round(value * 100);
  if (!Number.isSafeInteger(kobo) || kobo < 1 || kobo > MAX_PRICE_KOBO) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Price is outside the supported NGN range." });
  }
  return kobo;
}

function isSameInstant(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}

function redactMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMetadata);
  if (!value || typeof value !== "object") return value;
  const blocked = /token|secret|password|authorization|checkouturl|providerresponse|apikey/i;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    blocked.test(key) ? "[redacted]" : redactMetadata(entry),
  ]));
}

function safeAuditMetadata(metadata: Record<string, unknown>) {
  return redactMetadata(metadata) as Record<string, unknown>;
}

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Transaction = Parameters<Database["transaction"]>[0] extends (tx: infer T) => unknown ? T : never;

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not available." });
  return database;
}

async function requireAdminActor(tx: Transaction, actorUserId: number) {
  const rows = await tx.select({ id: users.id, role: users.role }).from(users)
    .where(eq(users.id, actorUserId)).limit(1).for("update");
  if (rows[0]?.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission for this action." });
  }
  return rows[0];
}

function productOutput(product: typeof sellerProducts.$inferSelect) {
  return {
    ...product,
    priceNaira: product.priceKobo / 100,
  };
}

async function productGallery(database: Database, productId: string) {
  return database.select({
    id: sellerProductImages.id,
    productId: sellerProductImages.productId,
    url: sellerProductImages.url,
    publicId: sellerProductImages.publicId,
    assetId: sellerProductImages.assetId,
    width: sellerProductImages.width,
    height: sellerProductImages.height,
    format: sellerProductImages.format,
    caption: sellerProductImages.caption,
    displayOrder: sellerProductImages.displayOrder,
    isPrimary: sellerProductImages.isPrimary,
    createdAt: sellerProductImages.createdAt,
  }).from(sellerProductImages).where(eq(sellerProductImages.productId, productId))
    .orderBy(asc(sellerProductImages.displayOrder), asc(sellerProductImages.id));
}

async function auditHistory(database: Database, productId: string) {
  const rows = await database.select({
    id: accountAuditEvents.id,
    eventType: accountAuditEvents.eventType,
    metadata: accountAuditEvents.metadata,
    createdAt: accountAuditEvents.createdAt,
    actor: { id: users.id, name: users.name, email: users.email },
  }).from(accountAuditEvents)
    .leftJoin(users, eq(users.id, accountAuditEvents.actorUserId))
    .where(sql`${accountAuditEvents.metadata}->>'productId' = ${productId}`)
    .orderBy(desc(accountAuditEvents.createdAt), desc(accountAuditEvents.id)).limit(100);
  return rows.map(row => ({ ...row, metadata: redactMetadata(row.metadata) }));
}

async function assertNoPendingReservations(tx: Transaction, productId: string) {
  const reservations = await tx.select({ id: orderItems.id }).from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.productId, productId), eq(orders.status, "pending_payment")))
    .limit(1);
  if (reservations.length) {
    throw new TRPCError({ code: "CONFLICT", message: "Inventory cannot be edited while customers have pending payment reservations for this listing." });
  }
}

async function loadLockedProduct(tx: Transaction, productId: string) {
  const rows = await tx.select().from(sellerProducts).where(eq(sellerProducts.id, productId)).limit(1).for("update");
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
  return rows[0];
}

async function recordProductAudit(tx: Transaction, input: {
  actorUserId: number;
  sellerUserId: number;
  productId: string;
  eventType: string;
  metadata?: Record<string, unknown>;
}) {
  await tx.insert(accountAuditEvents).values({
    actorUserId: input.actorUserId,
    targetUserId: input.sellerUserId,
    eventType: input.eventType,
    metadata: safeAuditMetadata({ productId: input.productId, ...input.metadata }),
  });
}

async function notifySeller(tx: Transaction, sellerUserId: number, productId: string, title: string, message: string, suffix: string) {
  await tx.insert(userNotifications).values({
    recipientUserId: sellerUserId,
    eventKey: notificationEventKey("admin-product", productId, suffix),
    category: "listing",
    title,
    message,
    href: "/seller",
  }).onConflictDoNothing();
}

async function listProducts(database: Database, input: z.output<typeof adminProductListInput>) {
  const stockFilter = input.stock === "in_stock"
    ? sql`${sellerProducts.inventoryCount} > 0`
    : input.stock === "out_of_stock"
      ? eq(sellerProducts.inventoryCount, 0)
      : input.stock === "low_stock"
        ? and(gtInventory(sellerProducts.inventoryCount, 0), sql`${sellerProducts.inventoryCount} <= ${LOW_STOCK_THRESHOLD}`)
        : undefined;
  const search = input.search ? `%${input.search}%` : undefined;
  const filters = [
    input.category ? eq(sellerProducts.category, input.category) : undefined,
    input.status ? eq(sellerProducts.status, input.status) : undefined,
    stockFilter,
    search ? or(ilike(sellerProducts.name, search), ilike(sellerProducts.category, search)) : undefined,
  ].filter(Boolean);
  const where = filters.length ? and(...filters) : undefined;
  const sortColumn = input.sort === "name" ? sellerProducts.name : input.sort === "price" ? sellerProducts.priceKobo : sellerProducts.createdAt;
  const order = input.direction === "asc" ? asc(sortColumn) : desc(sortColumn);
  const [rows, countRows] = await Promise.all([
    database.select({
      product: sellerProducts,
      seller: { id: users.id, name: users.name, email: users.email },
      store: { id: sellerStores.id, displayName: sellerStores.displayName, city: sellerStores.city, isActive: sellerStores.isActive },
      imageCount: sql<number>`(select count(*)::int from ${sellerProductImages} as spi where spi."productId" = ${sellerProducts.id})`,
      primaryImageCount: sql<number>`(select count(*)::int from ${sellerProductImages} as spi where spi."productId" = ${sellerProducts.id} and spi."isPrimary" = true)`,
    }).from(sellerProducts)
      .innerJoin(users, eq(users.id, sellerProducts.sellerUserId))
      .leftJoin(sellerStores, eq(sellerStores.userId, sellerProducts.sellerUserId))
      .where(where).orderBy(order, asc(sellerProducts.id)).limit(input.limit).offset(input.offset),
    database.select({ count: sql<number>`count(*)::int` }).from(sellerProducts)
      .where(where),
  ]);
  const total = Number(countRows[0]?.count ?? 0);
  return {
    items: rows.map(row => ({ ...productOutput(row.product), seller: row.seller, store: row.store, imageCount: Number(row.imageCount), primaryImageCount: Number(row.primaryImageCount) })),
    total,
    offset: input.offset,
    limit: input.limit,
    hasMore: input.offset + rows.length < total,
  };
}

// Keeps the low-stock predicate typed as a SQL expression without leaking a schema change.
function gtInventory(column: typeof sellerProducts.inventoryCount, minimum: number) {
  return sql`${column} > ${minimum}`;
}

export const adminProductManagementRouter = router({
  list: adminProcedure.input(adminProductListInput.optional()).query(async ({ input }) =>
    listProducts(await requireDatabase(), adminProductListInput.parse(input ?? {}))),

  categories: adminProcedure.query(async () => {
    const database = await requireDatabase();
    const rows = await database.select({
      category: sellerProducts.category,
      productCount: sql<number>`count(*)::int`,
    }).from(sellerProducts).groupBy(sellerProducts.category).orderBy(asc(sellerProducts.category));
    return rows.map(row => ({ category: row.category, productCount: Number(row.productCount) }));
  }),

  detail: adminProcedure.input(z.object({ productId: z.string().trim().min(1).max(64) }).strict()).query(async ({ input }) => {
    const database = await requireDatabase();
    const rows = await database.select({
      product: sellerProducts,
      seller: { id: users.id, name: users.name, email: users.email, role: users.role },
      application: { status: sellerApplications.status },
      store: { id: sellerStores.id, displayName: sellerStores.displayName, city: sellerStores.city, isActive: sellerStores.isActive },
    }).from(sellerProducts)
      .innerJoin(users, eq(users.id, sellerProducts.sellerUserId))
      .leftJoin(sellerApplications, eq(sellerApplications.userId, sellerProducts.sellerUserId))
      .leftJoin(sellerStores, eq(sellerStores.userId, sellerProducts.sellerUserId))
      .where(eq(sellerProducts.id, input.productId)).limit(1);
    const row = rows[0];
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
    const [images, history] = await Promise.all([productGallery(database, input.productId), auditHistory(database, input.productId)]);
    return { ...productOutput(row.product), seller: row.seller, application: row.application, store: row.store, images, history };
  }),

  create: adminProcedure.input(adminProductCreateInput).mutation(async ({ ctx, input }) => {
    const database = await requireDatabase();
    return database.transaction(async tx => {
      await requireAdminActor(tx, ctx.user.id);
      const sellerRows = await tx.select({
        id: users.id,
        role: users.role,
        applicationStatus: sellerApplications.status,
        storeActive: sellerStores.isActive,
      }).from(users)
        .innerJoin(sellerApplications, eq(sellerApplications.userId, users.id))
        .innerJoin(sellerStores, eq(sellerStores.userId, users.id))
        .where(and(eq(users.id, input.sellerUserId), eq(users.role, "seller"), eq(sellerApplications.status, "approved"), eq(sellerStores.isActive, true)))
        .limit(1).for("update");
      if (!sellerRows[0]) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an approved seller with an active store." });
      const id = `prod_${crypto.randomUUID().replaceAll("-", "")}`;
      const created = await tx.insert(sellerProducts).values({
        id,
        sellerUserId: input.sellerUserId,
        name: input.product.name,
        description: input.product.description,
        category: input.product.category,
        priceKobo: toKobo(input.product.priceNaira),
        sizes: input.product.sizes,
        inventoryCount: input.product.inventoryCount,
        status: "draft",
        imageUrl: null,
      }).returning();
      await recordProductAudit(tx, { actorUserId: ctx.user.id, sellerUserId: input.sellerUserId, productId: id, eventType: "admin_created_seller_product_draft", metadata: { status: "draft" } });
      await notifySeller(tx, input.sellerUserId, id, "A draft listing is ready for your review", "An administrator added a draft listing to your store. Review its details and publish it from your seller workspace.", "created");
      return productOutput(created[0]!);
    });
  }),

  update: adminProcedure.input(adminProductUpdateInput).mutation(async ({ ctx, input }) => {
    const database = await requireDatabase();
    return database.transaction(async tx => {
      await requireAdminActor(tx, ctx.user.id);
      const existing = await loadLockedProduct(tx, input.productId);
      if (!isSameInstant(existing.updatedAt, input.expectedUpdatedAt)) {
        throw new TRPCError({ code: "CONFLICT", message: "This product changed before your edit could be saved. Refresh and try again." });
      }
      if (input.changes.status === "published" && existing.status !== "published") {
        throw new TRPCError({ code: "CONFLICT", message: "Administrators cannot publish a seller draft. The seller must review and publish it." });
      }
      if (input.changes.inventoryCount !== undefined) await assertNoPendingReservations(tx, input.productId);
      const { priceNaira, ...rest } = input.changes;
      const updated = await tx.update(sellerProducts).set({
        ...rest,
        ...(priceNaira === undefined ? {} : { priceKobo: toKobo(priceNaira) }),
        updatedAt: new Date(),
      }).where(eq(sellerProducts.id, input.productId)).returning();
      const product = updated[0];
      if (!product) throw new TRPCError({ code: "CONFLICT", message: "Product changed before the edit could be saved. Refresh and try again." });
      await recordProductAudit(tx, {
        actorUserId: ctx.user.id,
        sellerUserId: product.sellerUserId,
        productId: product.id,
        eventType: "admin_updated_seller_product",
        metadata: { changedFields: Object.keys(input.changes), status: product.status },
      });
      await notifySeller(tx, product.sellerUserId, product.id, "Your product listing was updated", "An administrator updated your listing. Review the latest details in your seller workspace.", `updated-${product.updatedAt.getTime()}`);
      return productOutput(product);
    });
  }),

  delete: adminProcedure.input(adminProductDeleteInput).mutation(async ({ ctx, input }) => {
    const database = await requireDatabase();
    return database.transaction(async tx => {
      await requireAdminActor(tx, ctx.user.id);
      const product = await loadLockedProduct(tx, input.productId);
      if (product.name !== input.confirmationName) throw new TRPCError({ code: "BAD_REQUEST", message: "Type the exact product name to confirm deletion." });
      const references = await tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.productId, input.productId)).limit(1);
      if (references.length) throw new TRPCError({ code: "CONFLICT", message: "This product has order history and cannot be deleted. Archive it instead." });
      const images = await tx.select({ publicId: sellerProductImages.publicId, assetId: sellerProductImages.assetId, url: sellerProductImages.url }).from(sellerProductImages).where(eq(sellerProductImages.productId, input.productId));
      await recordProductAudit(tx, {
        actorUserId: ctx.user.id,
        sellerUserId: product.sellerUserId,
        productId: product.id,
        eventType: "admin_deleted_seller_product",
        metadata: {
          cleanupPending: images.some(image => Boolean(image.publicId || image.assetId)),
          providerAssets: images.map(image => ({ publicId: image.publicId, assetId: image.assetId, url: image.url })),
          deletedName: product.name,
        },
      });
      await tx.delete(sellerProducts).where(eq(sellerProducts.id, input.productId));
      return { productId: input.productId, deleted: true, cleanupPending: images.some(image => Boolean(image.publicId || image.assetId)) };
    });
  }),

  setPrimaryImage: adminProcedure.input(adminProductImageInput).mutation(async ({ ctx, input }) => {
    const database = await requireDatabase();
    return database.transaction(async tx => {
      await requireAdminActor(tx, ctx.user.id);
      const product = await loadLockedProduct(tx, input.productId);
      const images = await tx.select().from(sellerProductImages).where(and(eq(sellerProductImages.id, input.imageId), eq(sellerProductImages.productId, input.productId))).limit(1);
      const image = images[0];
      if (!image) throw new TRPCError({ code: "NOT_FOUND", message: "Product image not found." });
      await tx.update(sellerProductImages).set({ isPrimary: false }).where(eq(sellerProductImages.productId, input.productId));
      const selected = await tx.update(sellerProductImages).set({ isPrimary: true }).where(and(eq(sellerProductImages.id, input.imageId), eq(sellerProductImages.productId, input.productId))).returning();
      await tx.update(sellerProducts).set({ imageUrl: image.url, updatedAt: new Date() }).where(eq(sellerProducts.id, input.productId));
      await recordProductAudit(tx, { actorUserId: ctx.user.id, sellerUserId: product.sellerUserId, productId: product.id, eventType: "admin_set_product_primary_image", metadata: { imageId: image.id } });
      return { productId: product.id, image: selected[0]! };
    });
  }),

  removeImage: adminProcedure.input(adminProductRemoveImageInput).mutation(async ({ ctx, input }) => {
    const database = await requireDatabase();
    return database.transaction(async tx => {
      await requireAdminActor(tx, ctx.user.id);
      const product = await loadLockedProduct(tx, input.productId);
      const rows = await tx.select().from(sellerProductImages).where(and(eq(sellerProductImages.id, input.imageId), eq(sellerProductImages.productId, input.productId))).limit(1);
      const removed = rows[0];
      if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "Product image not found." });
      await tx.delete(sellerProductImages).where(eq(sellerProductImages.id, removed.id));
      const remaining = await tx.select().from(sellerProductImages).where(eq(sellerProductImages.productId, product.id)).orderBy(asc(sellerProductImages.displayOrder), asc(sellerProductImages.id));
      let primary = remaining.find(image => image.isPrimary) ?? null;
      if (!primary && remaining[0]) {
        const promoted = await tx.update(sellerProductImages).set({ isPrimary: true }).where(eq(sellerProductImages.id, remaining[0].id)).returning();
        primary = promoted[0] ?? remaining[0];
      }
      const nextStatus = !primary && product.status === "published" ? "draft" : product.status;
      const updated = await tx.update(sellerProducts).set({ imageUrl: primary?.url ?? null, status: nextStatus, updatedAt: new Date() }).where(eq(sellerProducts.id, product.id)).returning();
      await recordProductAudit(tx, {
        actorUserId: ctx.user.id,
        sellerUserId: product.sellerUserId,
        productId: product.id,
        eventType: "admin_removed_product_image",
        metadata: { imageId: removed.id, cleanupPending: Boolean(removed.publicId || removed.assetId), providerAsset: { publicId: removed.publicId, assetId: removed.assetId, url: removed.url }, status: nextStatus },
      });
      return { product: productOutput(updated[0]!), removedImageId: removed.id, primaryImageId: primary?.id ?? null, cleanupPending: Boolean(removed.publicId || removed.assetId) };
    });
  }),

  editImage: adminProcedure.input(adminProductImageEditInput).mutation(async ({ ctx, input }) => {
    const database = await requireDatabase();
    return database.transaction(async tx => {
      await requireAdminActor(tx, ctx.user.id);
      const product = await loadLockedProduct(tx, input.productId);
      const imageRows = await tx.select().from(sellerProductImages).where(and(eq(sellerProductImages.id, input.imageId), eq(sellerProductImages.productId, input.productId))).limit(1);
      if (!imageRows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Product image not found." });
      const updated = await tx.update(sellerProductImages).set({
        ...(input.caption === undefined ? {} : { caption: input.caption }),
        ...(input.displayOrder === undefined ? {} : { displayOrder: input.displayOrder }),
      }).where(eq(sellerProductImages.id, input.imageId)).returning();
      await tx.update(sellerProducts).set({ updatedAt: new Date() }).where(eq(sellerProducts.id, product.id));
      await recordProductAudit(tx, { actorUserId: ctx.user.id, sellerUserId: product.sellerUserId, productId: product.id, eventType: "admin_edited_product_image", metadata: { imageId: input.imageId, changedFields: [input.caption === undefined ? null : "caption", input.displayOrder === undefined ? null : "displayOrder"].filter(Boolean) } });
      return updated[0]!;
    });
  }),
});

export const adminProductRouter = adminProductManagementRouter;
