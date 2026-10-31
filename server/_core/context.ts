import { clerkClient, getAuth } from "@clerk/express";
import { TRPCError } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { EMAIL_VERIFICATION_REQUIRED_MSG } from "@shared/const";
import * as db from "../db";
import { ENV } from "./env";
import { getClerkServerConfig } from "./clerkConfig";

const PROFILE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function resolveClerkUser(req: CreateExpressContextOptions["req"]): Promise<User | null> {
  const clerkConfig = getClerkServerConfig(ENV);
  if (!clerkConfig.enabled) return null;

  const auth = getAuth(req);
  if (!auth.isAuthenticated || !auth.userId) return null;

  const clerkUserId = auth.userId;
  const identity = await clerkClient.users.getUser(clerkUserId);
  const primaryAddress = identity.emailAddresses.find(address => address.id === identity.primaryEmailAddressId);
  if (primaryAddress?.verification?.status !== "verified") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: EMAIL_VERIFICATION_REQUIRED_MSG });
  }

  let user = await db.getUserByClerkId(clerkUserId);
  const profileIsStale = !user?.lastSignedIn
    || Date.now() - user.lastSignedIn.getTime() > PROFILE_REFRESH_INTERVAL_MS;

  if (!user || profileIsStale || user.email !== primaryAddress.emailAddress) {
    const fullName = [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim();
    await db.upsertClerkUser({
      clerkUserId,
      name: fullName || identity.username || null,
      email: primaryAddress.emailAddress,
      lastSignedIn: new Date(),
    });
    user = await db.getUserByClerkId(clerkUserId);
  }

  if (user && ENV.ownerClerkUserId === clerkUserId && user.role === "customer") {
    await db.ensureInitialAdminForClerkUser(clerkUserId);
    user = await db.getUserByClerkId(clerkUserId);
  }

  return user ?? null;
}

export async function createContext(
  opts: CreateExpressContextOptions,
): Promise<TrpcContext> {
  const user = await resolveClerkUser(opts.req);
  return { req: opts.req, res: opts.res, user };
}
