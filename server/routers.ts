import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import type { User } from "../drizzle/schema";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router, sellerProcedure, staffProcedure } from "./_core/trpc";
import * as db from "./db";
import { initializePaystackCheckout, verifyPaystackTransaction, type PaystackChannel } from "./payments/paystack";

const sellerApplicationInput = z.object({
  legalName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(320),
  businessName: z.string().trim().min(2).max(160),
  craftSummary: z.string().trim().min(20).max(2_000),
  phone: z.string().trim().min(7).max(40),
  city: z.string().trim().min(2).max(100),
});
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
  channel: z.enum(["card", "bank_transfer", "ussd"]).default("card"),
});
const sellerProductFields = {
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().min(20).max(5_000),
  category: z.string().trim().min(2).max(80),
  priceNaira: z.number().int().min(1).max(21_000_000),
  imageUrl: z.string().trim().url().max(2_000)
    .refine(value => new URL(value).protocol === "https:", "Product images must use HTTPS.")
    .optional().nullable(),
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

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user ? publicAccount(opts.ctx.user) : null),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
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
    submitSellerApplication: protectedProcedure.input(sellerApplicationInput).mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "customer") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only customer accounts can submit a seller application." });
      }
      const existing = await db.getSellerApplicationByUserId(ctx.user.id);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "A seller application already exists for this account." });
      const application = await db.createSellerApplication(ctx.user.id, input);
      await db.createAccountAuditEvent({
        actorUserId: ctx.user.id,
        targetUserId: ctx.user.id,
        eventType: "seller_application_submitted",
        metadata: { applicationId: application?.id ?? null },
      });
      return application;
    }),
  }),

  orders: router({
    mine: protectedProcedure.query(({ ctx }) => db.listCustomerOrders(ctx.user.id)),
    createCheckout: protectedProcedure.input(checkoutInput).mutation(async ({ ctx, input }) => {
      if (!ENV.paystackSecretKey || !ENV.appBaseUrl) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Hosted checkout is not configured yet." });
      }
      const { channel, ...orderInput } = input;
      let created: Awaited<ReturnType<typeof db.createPendingOrder>>;
      try {
        created = await db.createPendingOrder(ctx.user.id, orderInput);
      } catch (error) {
        if (error instanceof db.CommerceValidationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
      if (created.existing) {
        if (created.authorizationUrl) {
          return { orderReference: created.order.reference, authorizationUrl: created.authorizationUrl };
        }
        throw new TRPCError({ code: "CONFLICT", message: "This checkout is already being prepared. Retry shortly." });
      }
      const channels: Record<typeof channel, PaystackChannel[]> = {
        card: ["card"],
        bank_transfer: ["bank_transfer"],
        ussd: ["ussd"],
      };
      try {
        const initialized = await initializePaystackCheckout({
          reference: created.paymentReference,
          email: input.email,
          amountKobo: created.order.totalKobo,
          channels: channels[channel],
        });
        const saved = await db.savePaymentCheckoutUrl(initialized.reference, initialized.authorizationUrl);
        if (!saved) throw new Error("Payment checkout is no longer pending.");
        return {
          orderReference: created.order.reference,
          authorizationUrl: initialized.authorizationUrl,
        };
      } catch (error) {
        await db.markPaymentFailed(created.paymentReference);
        console.warn("[Payments] Could not initialize hosted checkout:", error instanceof Error ? error.message : "unknown error");
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Secure checkout could not be started. No payment was taken." });
      }
    }),
    verifyMyPayment: protectedProcedure.input(z.object({ reference: z.string().min(8).max(64) })).mutation(async ({ ctx, input }) => {
      const record = await db.getPaymentForCustomer(ctx.user.id, input.reference);
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Order payment was not found." });
      if (record.payment.status === "succeeded" && record.order.status === "paid") return { status: "paid" as const };
      if (record.payment.status === "succeeded") {
        throw new TRPCError({ code: "CONFLICT", message: "Payment status needs manual review." });
      }
      if (record.payment.status !== "pending") return { status: "failed" as const };
      let verification;
      try {
        verification = await verifyPaystackTransaction(input.reference);
      } catch {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Payment status is not available yet. Please try again shortly." });
      }
      if (verification.reference !== input.reference) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: "Payment provider returned a different transaction reference." });
      }
      if (verification.status === "success") {
        const result = await db.markPaymentSucceeded({
          reference: input.reference,
          amountKobo: verification.amount,
          currency: verification.currency,
          providerTransactionId: String(verification.id),
        });
        if (!result.success) {
          throw new TRPCError({ code: "CONFLICT", message: "Payment needs manual review before this order can be confirmed." });
        }
        return { status: "paid" as const };
      }
      if (verification.status === "failed" || verification.status === "abandoned") {
        await db.markPaymentFailed(input.reference);
        return { status: "failed" as const };
      }
      return { status: "pending" as const };
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
    orders: sellerProcedure.query(({ ctx }) => db.listOrdersForSeller(ctx.user.id)),
  }),

  staff: router({
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
    users: adminProcedure.query(() => db.listUsersForAdmin()),
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
