import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import * as db from "../db";
import { hasCapability, requireRole, type Capability } from "./authorization";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    return { ...shape, data: { ...shape.data, stack: undefined } };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Please sign in to continue." });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const requireCapability = (capability: Capability) => t.middleware(async ({ ctx, next }) => {
  if (!ctx.user || !hasCapability(ctx.user, capability)) {
    throw new TRPCError({ code: ctx.user ? "FORBIDDEN" : "UNAUTHORIZED", message: "You do not have permission for this action." });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

const requireApprovedSeller = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user || !hasCapability(ctx.user, "seller:dashboard")) {
    throw new TRPCError({ code: ctx.user ? "FORBIDDEN" : "UNAUTHORIZED", message: "Active seller access is required for this action." });
  }
  const application = await db.getSellerApplicationByUserId(ctx.user.id);
  if (!application || application.status !== "approved") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Active seller access is required for this action." });
  }
  return next({ ctx: { ...ctx, user: ctx.user, sellerApplication: application } });
});

const requireAdmin = t.middleware(async ({ ctx, next }) => {
  requireRole(ctx.user, ["admin"]);
  return next({ ctx: { ...ctx, user: ctx.user! } });
});

export const protectedProcedure = t.procedure.use(requireUser);
export const sellerProcedure = protectedProcedure.use(requireApprovedSeller);
export const staffProcedure = protectedProcedure.use(requireCapability("seller:review"));
export const adminProcedure = protectedProcedure.use(requireAdmin);
