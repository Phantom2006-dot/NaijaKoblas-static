import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { User } from "../drizzle/schema";
import { canAccessSellerFulfillment } from "./_core/authorization";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router, sellerProcedure, staffProcedure } from "./_core/trpc";
import { fulfillmentStatuses } from "./commerce/fulfillment";
import * as db from "./db";
import { initializePaystackCheckout, verifyPaystackTransaction } from "./payments/paystack";
import { classifyPaystackTransaction } from "./payments/reconciliation";
import { productStatuses } from "../drizzle/schema";
import { adminProductManagementRouter } from "./admin/products";
import { adminOperationsRouter } from "./admin/operations";

const reviewInput = z.object({
  applicationId: z.number().int().positive(),
  status: z.enum(["approved", "rejected", "suspended"]),
  reviewNote: z.string().trim().max(1_000).optional(),
});
const profileInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(7).max(40),
  address: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(100),
});
const checkoutInput = profileInput.extend({
  idempotencyKey: z.uuid(),
  deliveryMethod: z.enum(["standard", "express"]),
  items: z.array(z.object({
    productId: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(20),
    size: z.string().trim().min(1).max(40),
  })).min(1).max(30),
});
const sellerProductFields = {
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().min(20).max(5_000),
  category: z.string().trim().min(2).max(80),
  priceNaira: z.number().int().min(1).max(21_000_000),
  sizes: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
  inventoryCount: z.number().int().min(0).max(1_000_000),
};
const publicAccount = (user: Pick<User, "id" | "name" | "email" | "role" | "createdAt" | "lastSignedIn">) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
  lastSignedIn: user.lastSignedIn,
});

async function rereadCustomerPaymentStatus(customerUserId: number, reference: string): Promise<"paid" | "failed" | "pending"> {
  const current = await db.getPaymentForCustomer(customerUserId, reference);
  if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Order payment was not found." });
  if (current.payment.status === "succeeded" && ["paid", "partially_fulfilled", "fulfilled"].includes(current.order.status)) return "paid";
  if (current.payment.status === "failed" || current.order.status === "payment_failed") return "failed";
  return "pending";
}

async function assertSellerFulfillmentAccess(user: User) {
  if (user.role === "seller") return;
  const application = await db.getSellerApplicationByUserId(user.id);
  if (!canAccessSellerFulfillment(user.role, application?.status ?? null)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Active seller access is required to manage order fulfillment." });
  }
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user ? publicAccount(opts.ctx.user) : null),
  }),

  notifications: router({
    mine: protectedProcedure.query(({ ctx }) => db.listUserNotifications(ctx.user.id)),
    markRead: protectedProcedure.input(z.object({ notificationId: z.number().int().positive() }))
      .mutation(({ ctx, input }) => db.markUserNotificationRead(ctx.user.id, input.notificationId)),
    markAllRead: protectedProcedure.mutation(({ ctx }) => db.markAllUserNotificationsRead(ctx.user.id)),
  }),

  catalog: router({
    list: publicProcedure.query(() => db.listPublicSellerProducts()),
  }),

  account: router({
    me: protectedProcedure.query(async ({ ctx }) => {
      const [sellerApplication, profile] = await Promise.all([
        db.getSellerApplicationByUserId(ctx.user.id),
        db.getCustomerProfile(ctx.user.id),
      ]);
      return { user: publicAccount(ctx.user), sellerApplication: sellerApplication ?? null, profile: profile ?? null };
    }),
    saveCustomerProfile: protectedProcedure.input(profileInput).mutation(({ ctx, input }) =>
      db.saveCustomerProfile(ctx.user.id, input),
    ),
    becomeSeller: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        return await db.activateSellerAccount(ctx.user.id);
      } catch (error) {
        if (error instanceof db.CommerceValidationError) {
          throw new TRPCError({ code: "FORBIDDEN", message: error.message });
        }
        throw error;
      }
    }),
    submitSellerApplication: protectedProcedure.input(z.unknown()).mutation(() => {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Seller application forms have been retired. Use the one-click Become a seller action; no application details are required.",
      });
    }),
  }),

  orders: router({
    mine: protectedProcedure.query(({ ctx }) => db.listCustomerOrders(ctx.user.id)),
    createCheckout: protectedProcedure.input(checkoutInput).mutation(async ({ ctx, input }) => {
      if (!ENV.paystackSecretKey || !ENV.appBaseUrl) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Paystack hosted checkout is not configured yet." });
      }
      let created: Awaited<ReturnType<typeof db.createPendingOrder>>;
      try {
        created = await db.createPendingOrder(ctx.user.id, input);
      } catch (error) {
        if (error instanceof db.CommerceValidationError) {
          const inactive = error.message.includes("no longer active");
          throw new TRPCError({ code: inactive ? "CONFLICT" : "BAD_REQUEST", message: inactive
            ? "The previous checkout attempt has finished. Review availability and start a fresh checkout."
            : error.message });
        }
        throw error;
      }
      if (created.authorizationUrl) {
        return { orderReference: created.order.reference, reference: created.paymentReference, authorizationUrl: created.authorizationUrl };
      }

      try {
        const initialized = await initializePaystackCheckout({
          reference: created.paymentReference,
          orderReference: created.order.reference,
          email: created.order.email,
          amountKobo: created.order.totalKobo,
          channels: ["card", "bank_transfer", "ussd"],
          deliveryMethod: created.order.deliveryMethod,
        });
        const saved = await db.savePaystackCheckoutUrl({
          reference: created.paymentReference,
          checkoutUrl: initialized.authorizationUrl,
        });
        if (!saved) throw new Error("Checkout is no longer pending.");
        return { orderReference: created.order.reference, reference: initialized.reference, authorizationUrl: initialized.authorizationUrl };
      } catch (error) {
        // A timeout may leave a provider transaction behind. Keep stock reserved
        // and require verification/reconciliation; never create a second order.
        console.warn("[Paystack] Could not confirm hosted checkout:", error instanceof Error ? error.message : "unknown error");
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Checkout could not be confirmed yet. Your order remains pending; retry the same checkout or contact support before submitting another order." });
      }
    }),
    verifyMyPayment: protectedProcedure.input(z.object({ reference: z.string().min(8).max(64) })).mutation(async ({ ctx, input }) => {
      const record = await db.getPaymentForCustomer(ctx.user.id, input.reference);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Order payment was not found." });
      if (record.payment.status === "succeeded" && ["paid", "partially_fulfilled", "fulfilled"].includes(record.order.status)) {
        return { status: "paid" as const, orderReference: record.order.reference };
      }
      if (record.payment.status === "succeeded") throw new TRPCError({ code: "CONFLICT", message: "Payment status needs manual review." });
      if (record.payment.status !== "pending") return { status: "failed" as const, orderReference: record.order.reference };

      let transaction;
      try {
        transaction = await verifyPaystackTransaction(input.reference);
      } catch {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Payment status is not available yet. Please try again shortly." });
      }
      const outcome = classifyPaystackTransaction(transaction, record.payment.reference);
      if (outcome === "mismatch") {
        throw new TRPCError({ code: "BAD_GATEWAY", message: "Paystack returned a transaction that does not match this order." });
      }
      if (outcome === "success") {
        const result = await db.markPaymentSucceeded({
          reference: record.payment.reference,
          amountKobo: transaction.amount,
          currency: transaction.currency,
          providerTransactionId: String(transaction.id),
        });
        if (!result.success) {
          const currentStatus = await rereadCustomerPaymentStatus(ctx.user.id, record.payment.reference);
          if (currentStatus !== "pending") return { status: currentStatus, orderReference: record.order.reference };
          throw new TRPCError({ code: "CONFLICT", message: "Payment needs manual review before this order can be confirmed." });
        }
        return { status: "paid" as const, orderReference: record.order.reference };
      }
      if (outcome === "failed") {
        const failed = await db.markPaymentFailed(record.payment.reference);
        if (!failed) {
          const currentStatus = await rereadCustomerPaymentStatus(ctx.user.id, record.payment.reference);
          if (currentStatus !== "pending") return { status: currentStatus, orderReference: record.order.reference };
          throw new TRPCError({ code: "CONFLICT", message: "Payment changed while status was being confirmed. Refresh your order history." });
        }
        return { status: "failed" as const, orderReference: record.order.reference };
      }
      return { status: "pending" as const, orderReference: record.order.reference };
    }),
  }),

  seller: router({
    dashboard: sellerProcedure.query(async ({ ctx }) => {
      const application = await db.getSellerApplicationByUserId(ctx.user.id);
      const [store, products, orders] = await Promise.all([
        db.getSellerStoreByUserId(ctx.user.id),
        db.listSellerProducts(ctx.user.id),
        db.listOrdersForSeller(ctx.user.id),
      ]);
      return { user: publicAccount(ctx.user), application, store, products, orders };
    }),
    updateStoreProfile: sellerProcedure.input(z.object({
      displayName: z.string().trim().min(2).max(160),
      city: z.string().trim().min(2).max(100),
      description: z.string().trim().max(1_000).optional(),
    })).mutation(async ({ ctx, input }) => {
      try {
        return await db.updateSellerStoreProfile(ctx.user.id, input);
      } catch (error) {
        if (error instanceof db.CommerceValidationError) throw new TRPCError({ code: "FORBIDDEN", message: error.message });
        throw error;
      }
    }),
    products: sellerProcedure.query(({ ctx }) => db.listSellerProducts(ctx.user.id)),
    createProduct: sellerProcedure.input(z.object(sellerProductFields)).mutation(({ ctx, input }) => {
      const { priceNaira, ...product } = input;
      return db.createSellerProduct(ctx.user.id, { ...product, priceKobo: priceNaira * 100 });
    }),
    updateProduct: sellerProcedure.input(z.object({
      productId: z.string().min(1).max(64),
      changes: z.object({
        ...sellerProductFields,
        status: z.enum(["draft", "published", "archived"]),
      }).partial().refine(changes => Object.keys(changes).length > 0, "At least one change is required."),
    })).mutation(async ({ ctx, input }) => {
      const { priceNaira, ...rest } = input.changes;
      try {
        const product = await db.updateSellerProduct({
          sellerUserId: ctx.user.id,
          productId: input.productId,
          changes: { ...rest, ...(priceNaira === undefined ? {} : { priceKobo: priceNaira * 100 }) },
        });
        if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
        return product;
      } catch (error) {
        if (error instanceof db.CommerceValidationError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }
    }),
    setPrimaryImage: sellerProcedure.input(z.object({
      productId: z.string().min(1).max(64),
      imageId: z.number().int().positive(),
    })).mutation(async ({ ctx, input }) => {
      const image = await db.setSellerProductPrimaryImage({ sellerUserId: ctx.user.id, ...input });
      if (!image) throw new TRPCError({ code: "NOT_FOUND", message: "Product image not found for this listing." });
      return image;
    }),
    orders: sellerProcedure.query(({ ctx }) => db.listOrdersForSeller(ctx.user.id)),
    fulfillmentOrders: protectedProcedure.query(async ({ ctx }) => {
      await assertSellerFulfillmentAccess(ctx.user);
      return db.listOrdersForSeller(ctx.user.id);
    }),
    updateOrderItemFulfillment: protectedProcedure.input(z.object({
      orderItemId: z.number().int().positive(),
      status: z.enum(fulfillmentStatuses),
      carrier: z.string().trim().min(1).max(100).nullable().optional(),
      trackingNumber: z.string().trim().min(1).max(120).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      await assertSellerFulfillmentAccess(ctx.user);
      const result = await db.updateSellerOrderItemFulfillment({
        sellerUserId: ctx.user.id,
        ...input,
      });
      if (!result.success) {
        const message = result.reason === "not_found"
          ? "Order item not found."
          : result.reason === "invalid_transition"
            ? "That fulfillment status change is not allowed."
            : "Only paid orders can be fulfilled.";
        throw new TRPCError({
          code: result.reason === "not_found" ? "NOT_FOUND" : "CONFLICT",
          message,
        });
      }
      return result;
    }),
  }),

  staff: router({
    activeSellers: staffProcedure.query(() => db.listActiveSellersForStaff()),
    createProductForSeller: staffProcedure.input(z.object({
      sellerUserId: z.number().int().positive(),
      product: z.object(sellerProductFields),
    })).mutation(async ({ ctx, input }) => {
      const { priceNaira, ...product } = input.product;
      try {
        return await db.createProductForStaff({
          actorUserId: ctx.user.id,
          sellerUserId: input.sellerUserId,
          product: { ...product, priceKobo: priceNaira * 100 },
        });
      } catch (error) {
        if (error instanceof db.CommerceValidationError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }
    }),
    sellerApplications: staffProcedure.input(z.object({ status: z.enum(["pending", "approved", "rejected", "suspended"]).optional() }).optional()).query(async ({ input }) =>
      db.listSellerApplications(input?.status),
    ),
    reviewSellerApplication: staffProcedure.input(reviewInput).mutation(async ({ ctx, input }) => {
      const decision = await db.transitionSellerApplication({ ...input, reviewerUserId: ctx.user.id });
      if (!decision.success) {
        const message = {
          not_found: "Seller application not found.",
          invalid_transition: "That seller application status change is not allowed.",
          account_missing: "Applicant account not found.",
          privileged_account: "Privileged accounts cannot be reviewed as sellers.",
          concurrent_change: "This seller application changed before the review could be saved. Refresh and try again.",
        }[decision.reason];
        throw new TRPCError({ code: decision.reason === "not_found" ? "NOT_FOUND" : "CONFLICT", message });
      }
      return decision.application;
    }),
  }),

  admin: router({
    productManagement: adminProductManagementRouter,
    operations: adminOperationsRouter,
    users: adminProcedure.query(() => db.listUsersForAdmin()),
    products: adminProcedure.input(z.object({
      afterId: z.string().min(1).max(64).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      search: z.string().trim().max(120).optional(),
      status: z.enum(productStatuses).optional(),
    }).optional()).query(({ input }) => db.listProductsForAdmin(input ?? {})),
    audit: adminProcedure.input(z.object({
      afterId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      eventType: z.string().trim().min(1).max(96).optional(),
    }).optional()).query(({ input }) => db.listAuditEventsForAdmin(input ?? {})),
    pendingPayments: adminProcedure.input(z.object({
      afterId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }).optional()).query(({ input }) => db.listPendingPaymentsForAdmin(input ?? {})),
    reconcilePayment: adminProcedure.input(z.object({ reference: z.string().min(8).max(64) })).mutation(async ({ ctx, input }) => {
      const record = await db.getPaymentByReference(input.reference);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Payment reference was not found." });
      if (record.payment.status === "succeeded" && ["paid", "partially_fulfilled", "fulfilled"].includes(record.order.status)) {
        return { status: "paid" as const, orderReference: record.order.reference };
      }
      if (record.payment.status === "failed") return { status: "failed" as const, orderReference: record.order.reference };
      if (record.payment.status !== "pending" || record.order.status !== "pending_payment") {
        throw new TRPCError({ code: "CONFLICT", message: "This payment is no longer pending and needs manual review." });
      }

      let transaction;
      try {
        transaction = await verifyPaystackTransaction(record.payment.reference);
      } catch {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Paystack status could not be retrieved. No payment or inventory state was changed." });
      }
      const outcome = classifyPaystackTransaction(transaction, record.payment.reference);
      if (outcome === "mismatch") {
        throw new TRPCError({ code: "CONFLICT", message: "Paystack reference, amount or NGN currency does not match. No state was changed; escalate this payment for review." });
      }
      if (outcome === "success") {
        const result = await db.markPaymentSucceeded({
          reference: record.payment.reference,
          amountKobo: transaction.amount,
          currency: transaction.currency,
          providerTransactionId: String(transaction.id),
          actorUserId: ctx.user.id,
        });
        if (!result.success) {
          const current = await db.getPaymentByReference(record.payment.reference);
          if (current?.payment.status === "succeeded" && ["paid", "partially_fulfilled", "fulfilled"].includes(current.order.status)) {
            return { status: "paid" as const, orderReference: record.order.reference };
          }
          if (current?.payment.status === "failed") return { status: "failed" as const, orderReference: record.order.reference };
          throw new TRPCError({ code: "CONFLICT", message: "Payment could not be reconciled automatically; review the audit trail." });
        }
        return { status: "paid" as const, orderReference: record.order.reference };
      }
      if (outcome === "failed") {
        const released = await db.markPaymentFailed(record.payment.reference, ctx.user.id);
        if (!released) {
          const current = await db.getPaymentByReference(record.payment.reference);
          if (current?.payment.status === "succeeded" && ["paid", "partially_fulfilled", "fulfilled"].includes(current.order.status)) {
            return { status: "paid" as const, orderReference: record.order.reference };
          }
          if (current?.payment.status === "failed") return { status: "failed" as const, orderReference: record.order.reference };
          throw new TRPCError({ code: "CONFLICT", message: "Payment changed while reconciliation was running. Refresh and inspect the order." });
        }
        return { status: "failed" as const, orderReference: record.order.reference };
      }
      return { status: "pending" as const, orderReference: record.order.reference };
    }),
    setStaffAccess: adminProcedure.input(z.object({ userId: z.number().int().positive(), grant: z.boolean() })).mutation(async ({ ctx, input }) => {
      const result = await db.changeStaffAccess({ actorUserId: ctx.user.id, targetUserId: input.userId, grant: input.grant });
      if (!result.success) {
        const message = {
          not_found: "Account not found.",
          self_change: "Administrators cannot change their own access.",
          admin_protected: "Administrator access cannot be changed here.",
          invalid_role_transition: "Only customer accounts can be granted staff access, and only staff accounts can have it revoked.",
          concurrent_change: "This account changed before the role update could be saved. Refresh and try again.",
        }[result.reason];
        throw new TRPCError({ code: result.reason === "not_found" ? "NOT_FOUND" : "CONFLICT", message });
      }
      return publicAccount(result.user);
    }),
  }),
});

export type AppRouter = typeof appRouter;
