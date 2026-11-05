import { randomUUID } from "node:crypto";
import { inArray, eq } from "drizzle-orm";

function requireDisposableLocalDatabase() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("operations.integration.ts requires DATABASE_URL.");
  const url = new URL(raw);
  if (!(["localhost", "127.0.0.1"] as string[]).includes(url.hostname)) {
    throw new Error("Refusing integration tests: DATABASE_URL must point to localhost or 127.0.0.1.");
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!databaseName.startsWith("koblas_upgrade_")) {
    throw new Error("Refusing integration tests: database name must start with koblas_upgrade_.");
  }
  return raw;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const databaseUrl = requireDisposableLocalDatabase();
process.env.DATABASE_URL = databaseUrl;

const { getDb } = await import("../db");
const {
  accountAuditEvents,
  customerProfiles,
  orderItems,
  orders,
  paymentTransactions,
  sellerProducts,
  users,
} = await import("../../drizzle/schema");
const {
  getAdminOverview,
  listAdminOrders,
  getAdminOrderDetail,
  listAdminCustomers,
  getAdminCustomerDetail,
  updateAdminOrderItemFulfillment,
} = await import("./operations");

const database = await getDb();
assert(database, "Database is not available.");

const token = randomUUID().replaceAll("-", "");
const adminOpenId = `upgrade-admin-${token}`;
const customerOpenId = `upgrade-customer-${token}`;
const secondCustomerOpenId = `upgrade-customer-two-${token}`;
const sellerOpenId = `upgrade-seller-${token}`;
const staffOpenId = `upgrade-staff-${token}`;
const checkoutUrl = `https://paystack.invalid/secret/${token}`;

let userIds: number[] = [];
let productIds: string[] = [];
let orderIds: number[] = [];
let paymentIds: number[] = [];
let orderItemIds: number[] = [];

try {
  const [admin, customer, secondCustomer, seller, staff] = await database.insert(users).values([
    { openId: adminOpenId, name: "Upgrade Admin", email: `${adminOpenId}@example.test`, role: "admin" },
    { openId: customerOpenId, name: "Ada Upgrade", email: `${customerOpenId}@example.test`, role: "customer" },
    { openId: secondCustomerOpenId, name: "Bola Upgrade", email: `${secondCustomerOpenId}@example.test`, role: "customer" },
    { openId: sellerOpenId, name: "Seller Upgrade", email: `${sellerOpenId}@example.test`, role: "seller" },
    { openId: staffOpenId, name: "Staff Upgrade", email: `${staffOpenId}@example.test`, role: "staff" },
  ]).returning({ id: users.id });
  userIds = [admin.id, customer.id, secondCustomer.id, seller.id, staff.id];

  await database.insert(customerProfiles).values({
    userId: customer.id,
    firstName: "Ada",
    lastName: "Upgrade",
    email: `${customerOpenId}@example.test`,
    phone: "08000000000",
    address: "1 Upgrade Street",
    city: "Lagos",
  });

  productIds = [`prod_upgrade_${token}_a`, `prod_upgrade_${token}_b`];
  await database.insert(sellerProducts).values([
    {
      id: productIds[0], sellerUserId: seller.id, name: "Upgrade Bag", description: "A disposable integration product.",
      category: `upgrade-category-${token}`, priceKobo: 2_500, sizes: ["One size"], inventoryCount: 20, status: "published",
    },
    {
      id: productIds[1], sellerUserId: seller.id, name: "Upgrade Belt", description: "Another disposable integration product.",
      category: `upgrade-category-${token}`, priceKobo: 3_300, sizes: ["M"], inventoryCount: 2, status: "published",
    },
  ]);

  const makeOrder = async (input: {
    customerUserId: number;
    totalKobo: number;
    status: "pending_payment" | "paid" | "fulfilled";
    paymentStatus: "pending" | "succeeded";
    verifiedAt: Date | null;
    suffix: string;
    productId: string;
    checkout?: string | null;
  }) => {
    const reference = `UPGRADE-${token}-${input.suffix}`;
    const [order] = await database.insert(orders).values({
      reference,
      customerUserId: input.customerUserId,
      idempotencyKey: randomUUID(),
      idempotencyFingerprint: randomUUID().replaceAll("-", ""),
      status: input.status,
      currency: "NGN",
      firstName: "Ada",
      lastName: "Upgrade",
      email: `${customerOpenId}@example.test`,
      phone: "08000000000",
      address: "1 Upgrade Street",
      city: "Lagos",
      deliveryMethod: "standard",
      subtotalKobo: input.totalKobo,
      shippingKobo: 0,
      totalKobo: input.totalKobo,
    }).returning({ id: orders.id, reference: orders.reference });
    const [item] = await database.insert(orderItems).values({
      orderId: order.id,
      productId: input.productId,
      sellerUserId: seller.id,
      nameSnapshot: input.productId === productIds[0] ? "Upgrade Bag" : "Upgrade Belt",
      makerSnapshot: "Seller Upgrade",
      unitPriceKobo: input.totalKobo,
      quantity: 1,
      size: "One size",
      lineTotalKobo: input.totalKobo,
      fulfillmentStatus: input.status === "fulfilled" ? "fulfilled" : "unfulfilled",
    }).returning({ id: orderItems.id });
    const [payment] = await database.insert(paymentTransactions).values({
      orderId: order.id,
      provider: "paystack",
      reference,
      status: input.paymentStatus,
      amountKobo: input.totalKobo,
      currency: "NGN",
      checkoutUrl: input.checkout ?? null,
      providerTransactionId: input.paymentStatus === "succeeded" ? `provider-${token}-${input.suffix}` : null,
      verifiedAt: input.verifiedAt,
    }).returning({ id: paymentTransactions.id });
    orderIds.push(order.id);
    orderItemIds.push(item.id);
    paymentIds.push(payment.id);
    return { order, item, payment };
  };

  const recentPaid = await makeOrder({
    customerUserId: customer.id, totalKobo: 2_500, status: "paid", paymentStatus: "succeeded",
    verifiedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1_000), suffix: "recent", productId: productIds[0],
  });
  const fulfilledPaid = await makeOrder({
    customerUserId: customer.id, totalKobo: 3_300, status: "fulfilled", paymentStatus: "succeeded",
    verifiedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1_000), suffix: "fulfilled", productId: productIds[1],
  });
  await makeOrder({
    customerUserId: customer.id, totalKobo: 9_000, status: "fulfilled", paymentStatus: "succeeded",
    verifiedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1_000), suffix: "old", productId: productIds[1],
  });
  const unpaid = await makeOrder({
    customerUserId: secondCustomer.id, totalKobo: 1_500, status: "pending_payment", paymentStatus: "pending",
    verifiedAt: null, suffix: "unpaid", productId: productIds[0], checkout: checkoutUrl,
  });

  const overview = await getAdminOverview();
  assert(overview.totalProducts >= 2, "Overview did not count seeded products.");
  assert(overview.totalOrders >= 4, "Overview did not count seeded orders.");
  assert(overview.revenueKobo >= 14_800, "Overview revenue omitted valid succeeded orders or included too little.");
  assert(!overview.recentOrders.some(order => JSON.stringify(order).includes(checkoutUrl)), "Overview leaked checkoutUrl.");
  assert(overview.salesLast30Days.reduce((sum, day) => sum + day.revenueKobo, 0) >= 5_800, "Last-30-day revenue missed recent verified payments.");
  assert(overview.salesLast30Days.reduce((sum, day) => sum + day.revenueKobo, 0) < 14_800, "Last-30-day revenue included the stale verified payment.");

  const page = await listAdminOrders({ search: recentPaid.order.reference, offset: 0, limit: 1 });
  assert(page.total === 1 && page.items.length === 1, "Order search/count pagination failed.");
  const detail = await getAdminOrderDetail(unpaid.order.reference);
  assert(detail?.payment.status === "pending", "Order detail did not return payment status.");
  assert(!JSON.stringify(detail).includes(checkoutUrl), "Order detail leaked checkoutUrl/provider data.");

  const customers = await listAdminCustomers({ search: customerOpenId, offset: 0, limit: 1 });
  assert(customers.total === 1 && customers.items[0]?.orderCount >= 3, "Customer order count/spend aggregation failed.");
  assert(customers.items[0]?.spendKobo >= 14_800, "Customer verified spend aggregation failed.");
  const customerDetail = await getAdminCustomerDetail(customer.id, 2);
  assert(customerDetail?.orders.limit === 2 && customerDetail.orders.hasMore, "Customer detail did not report bounded history explicitly.");

  const processing = await updateAdminOrderItemFulfillment({ actorUserId: admin.id, orderItemId: recentPaid.item.id, status: "processing" });
  assert(processing.success && processing.orderStatus === "paid", "Admin processing transition failed.");
  const shipped = await updateAdminOrderItemFulfillment({ actorUserId: admin.id, orderItemId: recentPaid.item.id, status: "shipped", carrier: "DHL", trackingNumber: "UPGRADE-TRACK" });
  assert(shipped.success && shipped.orderStatus === "partially_fulfilled", "Admin shipped transition did not derive partial order state.");
  const fulfilled = await updateAdminOrderItemFulfillment({ actorUserId: admin.id, orderItemId: recentPaid.item.id, status: "fulfilled" });
  assert(fulfilled.success && fulfilled.orderStatus === "fulfilled", "Admin fulfilled transition failed.");
  const unpaidResult = await updateAdminOrderItemFulfillment({ actorUserId: admin.id, orderItemId: unpaid.item.id, status: "processing" });
  assert(!unpaidResult.success && unpaidResult.reason === "order_not_fulfillable", "Unpaid fulfillment was not rejected.");
  const unchangedPayment = await database.select({ status: paymentTransactions.status }).from(paymentTransactions)
    .where(eq(paymentTransactions.id, unpaid.payment.id)).limit(1);
  assert(unchangedPayment[0]?.status === "pending", "Unpaid fulfillment mutated payment state.");

  const audits = await database.select({ actorUserId: accountAuditEvents.actorUserId, eventType: accountAuditEvents.eventType })
    .from(accountAuditEvents).where(eq(accountAuditEvents.actorUserId, admin.id));
  assert(audits.some(audit => audit.eventType === "admin_order_item_fulfillment_updated"), "Admin fulfillment audit actor was not recorded.");

  console.log("admin operations integration passed", JSON.stringify({
    seeded: { users: userIds.length, products: productIds.length, orders: orderIds.length, items: orderItemIds.length },
    revenueKobo: overview.revenueKobo,
    recentSalesKobo: overview.salesLast30Days.reduce((sum, day) => sum + day.revenueKobo, 0),
  }));
} finally {
  if (paymentIds.length) await database.delete(paymentTransactions).where(inArray(paymentTransactions.id, paymentIds));
  if (orderIds.length) await database.delete(orders).where(inArray(orders.id, orderIds));
  if (productIds.length) await database.delete(sellerProducts).where(inArray(sellerProducts.id, productIds));
  if (userIds.length) await database.delete(customerProfiles).where(inArray(customerProfiles.userId, userIds));
  if (userIds.length) await database.delete(users).where(inArray(users.id, userIds));
}
