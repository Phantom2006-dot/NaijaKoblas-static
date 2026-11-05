import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { sellerApplications, sellerProductImages, sellerProducts, sellerStores, orderItems, orders, users, userNotifications } from "../../drizzle/schema";
import { listPublicSellerProducts } from "../db";
import { getDb } from "../db";
import { adminProductManagementRouter } from "./products";
import type { TrpcContext } from "../_core/context";

type TestUser = typeof users.$inferSelect;

function requireSafeDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required for the product integration harness.");
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (!(host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1")) {
    throw new Error("Product integration tests only accept localhost PostgreSQL hosts.");
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!databaseName.startsWith("koblas_upgrade_")) {
    throw new Error("Product integration tests require a random database name beginning koblas_upgrade_.");
  }
}

function context(user: TestUser): TrpcContext {
  return { req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], user };
}

async function expectCode(action: Promise<unknown>, code: string, text?: string) {
  await assert.rejects(action, error => {
    assert.equal((error as { code?: string }).code, code);
    if (text) assert.match(String((error as { message?: string }).message), new RegExp(text, "i"));
    return true;
  });
}

async function main() {
  requireSafeDatabaseUrl();
  const database = await getDb();
  if (!database) throw new Error("Database is not available.");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const openId = (role: string) => `koblas-upgrade-${tag}-${role}`;
  let admin!: TestUser;
  let seller!: TestUser;
  let customer!: TestUser;
  let staff!: TestUser;
  let seededUserIds: number[] = [];
  let seededSellerId: number | undefined;
  const productIds: string[] = [];
  const orderIds: number[] = [];

  try {
    [admin, seller, customer, staff] = await database.insert(users).values([
      { openId: openId("admin"), name: "Upgrade Admin", email: `${tag}-admin@example.invalid`, role: "admin", loginMethod: "integration" },
      { openId: openId("seller"), name: "Upgrade Seller", email: `${tag}-seller@example.invalid`, role: "seller", loginMethod: "integration" },
      { openId: openId("customer"), name: "Upgrade Customer", email: `${tag}-customer@example.invalid`, role: "customer", loginMethod: "integration" },
      { openId: openId("staff"), name: "Upgrade Staff", email: `${tag}-staff@example.invalid`, role: "staff", loginMethod: "integration" },
    ]).returning();
    seededUserIds = [admin.id, seller.id, customer.id, staff.id];
    seededSellerId = seller.id;
    await database.insert(sellerApplications).values({
      userId: seller.id,
      legalName: "Upgrade Seller Legal",
      email: seller.email!,
      businessName: "Upgrade Seller Goods",
      craftSummary: "Integration seller application for product management.",
      phone: "+2348000000000",
      city: "Lagos",
      status: "approved",
    });
    await database.insert(sellerStores).values({ userId: seller.id, displayName: "Upgrade Seller Goods", city: "Lagos", isActive: true });

    const publicProductId = `prod_${randomUUID().replaceAll("-", "")}`;
    const draftProductId = `prod_${randomUUID().replaceAll("-", "")}`;
    const referencedProductId = `prod_${randomUUID().replaceAll("-", "")}`;
    productIds.push(publicProductId, draftProductId, referencedProductId);
    const [publicProduct, draftProduct] = await database.insert(sellerProducts).values([
      {
        id: publicProductId,
        sellerUserId: seller.id,
        name: "Original Public Belt",
        description: "A public integration listing used to verify administrator edits.",
        category: "Belts",
        priceKobo: 100000,
        imageUrl: "https://res.cloudinary.com/test/image/upload/v1/initial.jpg",
        sizes: ["M", "L"],
        inventoryCount: 3,
        status: "published",
      },
      {
        id: draftProductId,
        sellerUserId: seller.id,
        name: "Existing Draft",
        description: "A draft integration listing used to verify seller publication boundaries.",
        category: "Bags",
        imageUrl: null,
        sizes: ["One size"],
        priceKobo: 45000,
        inventoryCount: 5,
        status: "draft",
      },
      {
        id: referencedProductId,
        sellerUserId: seller.id,
        name: "Historical Belt",
        description: "A historical integration listing that cannot be physically deleted.",
        category: "Belts",
        imageUrl: null,
        sizes: ["M"],
        priceKobo: 75000,
        inventoryCount: 2,
        status: "archived",
      },
    ]).returning();
    assert.equal(publicProduct.id, publicProductId);
    assert.equal(draftProduct.id, draftProductId);
    await database.insert(sellerProductImages).values([
      { productId: publicProductId, createdByUserId: seller.id, url: "https://res.cloudinary.com/test/image/upload/v1/first.jpg", publicId: "test/first", assetId: "asset-first", width: 100, height: 100, format: "jpg", displayOrder: 0, isPrimary: true },
      { productId: publicProductId, createdByUserId: seller.id, url: "https://res.cloudinary.com/test/image/upload/v1/second.jpg", publicId: "test/second", assetId: "asset-second", width: 100, height: 100, format: "jpg", displayOrder: 1, isPrimary: false },
    ]);

    const referencedOrder = await database.insert(orders).values({
      reference: `NK${tag}HISTORY`, customerUserId: customer.id, idempotencyKey: `history-${tag}`, idempotencyFingerprint: `fingerprint-${tag}`,
      status: "paid", currency: "NGN", firstName: "Upgrade", lastName: "Customer", email: customer.email!, phone: "+2348000000000",
      address: "1 Integration Street", city: "Lagos", deliveryMethod: "standard", subtotalKobo: 75000, shippingKobo: 0, totalKobo: 75000,
    }).returning({ id: orders.id });
    orderIds.push(referencedOrder[0]!.id);
    await database.insert(orderItems).values({
      orderId: referencedOrder[0]!.id, productId: referencedProductId, sellerUserId: seller.id, nameSnapshot: "Historical Belt", makerSnapshot: "Upgrade Seller Goods",
      unitPriceKobo: 75000, quantity: 1, size: "M", lineTotalKobo: 75000,
    });

    const caller = adminProductManagementRouter.createCaller(context(admin));
    const created = await caller.create({
      sellerUserId: seller.id,
      product: { name: "Admin Draft Belt", description: "A draft created on behalf of the approved seller.", category: "Belts", priceNaira: 1250.75, sizes: ["M"], inventoryCount: 8 },
    });
    productIds.push(created.id);
    assert.equal(created.status, "draft");
    assert.equal(created.sellerUserId, seller.id);
    assert.equal(created.priceKobo, 125075);
    const notification = await database.select({ id: userNotifications.id }).from(userNotifications).where(and(eq(userNotifications.recipientUserId, seller.id), like(userNotifications.eventKey, `admin-product:${created.id}:%`))).limit(1);
    assert.equal(notification.length, 1, "seller notification should be emitted with the draft");
    const createdDetail = await caller.detail({ productId: created.id });
    assert.equal(createdDetail.seller.id, seller.id);
    assert.equal(createdDetail.history.some(event => event.actor?.id === admin.id), true, "detail history should retain the acting administrator");
    await expectCode(caller.update({ productId: created.id, expectedUpdatedAt: created.updatedAt, changes: { status: "published" } }), "CONFLICT", "cannot publish");

    const list = await caller.list({ search: "Admin Draft", stock: "in_stock", sort: "price", direction: "asc", offset: 0, limit: 10 });
    assert.equal(list.total, 1);
    assert.equal(list.items[0]?.id, created.id);
    const categories = await caller.categories();
    assert.equal(categories.some(category => category.category === "Belts"), true);

    const originalUpdatedAt = publicProduct.updatedAt;
    const edited = await caller.update({
      productId: publicProductId,
      expectedUpdatedAt: originalUpdatedAt,
      changes: { name: "Edited Public Belt", priceNaira: 2222.22, inventoryCount: 7 },
    });
    assert.equal(edited.name, "Edited Public Belt");
    assert.equal(edited.priceKobo, 222222);
    assert.equal(edited.inventoryCount, 7);
    await expectCode(caller.update({ productId: publicProductId, expectedUpdatedAt: originalUpdatedAt, changes: { name: "Stale Edit" } }), "CONFLICT", "changed");
    const publicCatalog = await listPublicSellerProducts();
    const visible = publicCatalog.find(product => product.id === publicProductId);
    assert.equal(visible?.name, "Edited Public Belt");
    assert.equal(visible?.priceKobo, 222222);
    assert.equal(visible?.inventoryCount, 7);

    const reservationOrder = await database.insert(orders).values({
      reference: `NK${tag}RESERVE`, customerUserId: customer.id, idempotencyKey: `reserve-${tag}`, idempotencyFingerprint: `reserve-fingerprint-${tag}`,
      status: "pending_payment", currency: "NGN", firstName: "Upgrade", lastName: "Customer", email: customer.email!, phone: "+2348000000000",
      address: "1 Integration Street", city: "Lagos", deliveryMethod: "standard", subtotalKobo: 222222, shippingKobo: 0, totalKobo: 222222,
    }).returning({ id: orders.id });
    orderIds.push(reservationOrder[0]!.id);
    await database.insert(orderItems).values({
      orderId: reservationOrder[0]!.id, productId: publicProductId, sellerUserId: seller.id, nameSnapshot: "Edited Public Belt", makerSnapshot: "Upgrade Seller Goods",
      unitPriceKobo: 222222, quantity: 1, size: "M", lineTotalKobo: 222222,
    });
    const currentPublic = await caller.detail({ productId: publicProductId });
    await expectCode(caller.update({ productId: publicProductId, expectedUpdatedAt: currentPublic.updatedAt, changes: { inventoryCount: 6 } }), "CONFLICT", "reservations");

    const gallery = await caller.detail({ productId: publicProductId });
    const second = gallery.images.find(image => image.publicId === "test/second")!;
    await caller.setPrimaryImage({ productId: publicProductId, imageId: second.id });
    const primaryChanged = await caller.detail({ productId: publicProductId });
    assert.equal(primaryChanged.imageUrl, second.url);
    assert.equal(primaryChanged.images.find(image => image.id === second.id)?.isPrimary, true);
    await caller.removeImage({ productId: publicProductId, imageId: second.id, confirm: true });
    const oneImage = await caller.detail({ productId: publicProductId });
    assert.equal(oneImage.images.length, 1);
    assert.equal(oneImage.images[0]?.isPrimary, true);
    await caller.removeImage({ productId: publicProductId, imageId: oneImage.images[0]!.id, confirm: true });
    const unpublished = await caller.detail({ productId: publicProductId });
    assert.equal(unpublished.images.length, 0);
    assert.equal(unpublished.imageUrl, null);
    assert.equal(unpublished.status, "draft");
    const hidden = await listPublicSellerProducts();
    assert.equal(hidden.some(product => product.id === publicProductId), false);

    await expectCode(caller.delete({ productId: referencedProductId, confirmationName: "Historical Belt" }), "CONFLICT", "archive");
    const archived = await caller.update({ productId: referencedProductId, expectedUpdatedAt: (await caller.detail({ productId: referencedProductId })).updatedAt, changes: { status: "archived" } });
    assert.equal(archived.status, "archived");

    for (const roleUser of [customer, seller, staff]) {
      const roleCaller = adminProductManagementRouter.createCaller(context(roleUser));
      await expectCode(roleCaller.list({}), "FORBIDDEN");
      await expectCode(roleCaller.delete({ productId: created.id, confirmationName: created.name }), "FORBIDDEN");
    }
    console.log("PASS admin product integration: create/edit/detail/list/public catalog/conflict/reservation/deletion/gallery/audit/role boundaries");
  } finally {
    // This harness owns only its tagged rows. Cleanup is local and happens before the process exits.
    if (orderIds.length) {
      await database.delete(orderItems).where(inArray(orderItems.orderId, orderIds));
      await database.delete(orders).where(inArray(orders.id, orderIds));
    }
    if (productIds.length) await database.delete(sellerProducts).where(inArray(sellerProducts.id, productIds));
    if (seededSellerId !== undefined) {
      await database.delete(sellerApplications).where(eq(sellerApplications.userId, seededSellerId));
      await database.delete(sellerStores).where(eq(sellerStores.userId, seededSellerId));
    }
    if (seededUserIds.length) await database.delete(users).where(inArray(users.id, seededUserIds));
  }
}

main().then(() => process.exit(0)).catch(error => {
  console.error(error);
  process.exit(1);
});
