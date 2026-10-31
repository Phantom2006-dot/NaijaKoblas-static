import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { clerkClient, getAuth } from "@clerk/express";
import type { User } from "../../drizzle/schema";
import { EMAIL_VERIFICATION_REQUIRED_MSG } from "@shared/const";
import * as db from "../db";
import { createContext } from "./context";

vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: vi.fn() } },
  getAuth: vi.fn(),
  clerkMiddleware: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function options() {
  return { req: { headers: {}, path: "/api/trpc/auth.me" }, res: {} } as CreateExpressContextOptions;
}

function authenticate(userId: string | null, isAuthenticated = Boolean(userId)) {
  vi.mocked(getAuth).mockReturnValue({ userId, isAuthenticated } as never);
}

function account(clerkUserId = "user_clerk", role: User["role"] = "customer"): User {
  const now = new Date();
  return {
    id: 12,
    openId: clerkUserId,
    name: "Clerk User",
    email: "clerk@example.com",
    loginMethod: "clerk",
    role,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

function configureClerk() {
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_only");
  vi.stubEnv("CLERK_PUBLISHABLE_KEY", "pk_test_only");
  vi.stubEnv("APP_BASE_URL", "https://naijakoblas-static.vercel.app");
}

function setClerkIdentity(userId: string, verificationStatus: "verified" | "unverified" = "verified") {
  vi.mocked(clerkClient.users.getUser).mockResolvedValue({
    id: userId,
    firstName: "Clerk",
    lastName: "User",
    username: null,
    primaryEmailAddressId: "email_primary",
    emailAddresses: [{
      id: "email_primary",
      emailAddress: "clerk@example.com",
      verification: { status: verificationStatus },
    }],
  } as never);
}

describe("Clerk request authentication", () => {
  it("keeps public requests anonymous when Clerk is not configured", async () => {
    const getAuthSpy = vi.mocked(getAuth);
    const getUser = vi.spyOn(db, "getUserByClerkId");
    const context = await createContext(options());
    expect(context.user).toBeNull();
    expect(getAuthSpy).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("treats requests without a valid Clerk session as anonymous", async () => {
    configureClerk();
    authenticate(null, false);
    const getUser = vi.spyOn(db, "getUserByClerkId");
    const context = await createContext(options());
    expect(context.user).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
    expect(clerkClient.users.getUser).not.toHaveBeenCalled();
  });

  it("uses an existing Clerk-linked account only after verifying its current primary email", async () => {
    configureClerk();
    authenticate("user_clerk");
    setClerkIdentity("user_clerk");
    const existing = account();
    vi.spyOn(db, "getUserByClerkId").mockResolvedValue(existing);
    const context = await createContext(options());
    expect(context.user).toEqual(existing);
    expect(clerkClient.users.getUser).toHaveBeenCalledWith("user_clerk");
  });

  it("syncs a verified Clerk email/name into a role-safe new account", async () => {
    configureClerk();
    authenticate("user_new");
    vi.mocked(clerkClient.users.getUser).mockResolvedValue({
      id: "user_new",
      firstName: "New",
      lastName: "Member",
      username: null,
      primaryEmailAddressId: "email_primary",
      emailAddresses: [{ id: "email_primary", emailAddress: "new@example.com", verification: { status: "verified" } }],
    } as never);
    vi.spyOn(db, "getUserByClerkId").mockResolvedValueOnce(undefined).mockResolvedValueOnce(account("user_new"));
    const upsert = vi.spyOn(db, "upsertClerkUser").mockResolvedValue();
    const context = await createContext(options());
    expect(upsert).toHaveBeenCalledWith({
      clerkUserId: "user_new",
      name: "New Member",
      email: "new@example.com",
      lastSignedIn: expect.any(Date),
    });
    expect(context.user?.role).toBe("customer");
  });

  it("rejects an unverified identity before reading or creating an application account", async () => {
    configureClerk();
    authenticate("user_unverified");
    setClerkIdentity("user_unverified", "unverified");
    const getUser = vi.spyOn(db, "getUserByClerkId");
    const upsert = vi.spyOn(db, "upsertClerkUser");

    await expect(createContext(options())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: EMAIL_VERIFICATION_REQUIRED_MSG,
    } satisfies Partial<TRPCError>);
    expect(getUser).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("never bootstraps a configured owner whose current primary email is unverified", async () => {
    configureClerk();
    vi.stubEnv("OWNER_CLERK_USER_ID", "user_owner");
    authenticate("user_owner");
    setClerkIdentity("user_owner", "unverified");
    const getUser = vi.spyOn(db, "getUserByClerkId");
    const bootstrap = vi.spyOn(db, "ensureInitialAdminForClerkUser");

    await expect(createContext(options())).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(getUser).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("bootstraps only the configured owner Clerk ID and rereads the resulting role", async () => {
    configureClerk();
    vi.stubEnv("OWNER_CLERK_USER_ID", "user_owner");
    authenticate("user_owner");
    setClerkIdentity("user_owner");
    vi.spyOn(db, "getUserByClerkId").mockResolvedValueOnce(account("user_owner", "customer")).mockResolvedValueOnce(account("user_owner", "admin"));
    const bootstrap = vi.spyOn(db, "ensureInitialAdminForClerkUser").mockResolvedValue();
    const context = await createContext(options());
    expect(bootstrap).toHaveBeenCalledWith("user_owner");
    expect(context.user?.role).toBe("admin");
  });

  it("surfaces database failures rather than converting them to anonymous access", async () => {
    configureClerk();
    authenticate("user_clerk");
    setClerkIdentity("user_clerk");
    vi.spyOn(db, "getUserByClerkId").mockRejectedValue(new Error("Neon unavailable"));
    await expect(createContext(options())).rejects.toThrow("Neon unavailable");
  });
});
