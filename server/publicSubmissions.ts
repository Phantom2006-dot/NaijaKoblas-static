import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { contactMessages, newsletterSubscriptions } from "../drizzle/schema";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";

const MAX_PAGE_SIZE = 100;

function requireDatabase(database: Awaited<ReturnType<typeof getDb>>) {
  if (!database) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The database is not available." });
  return database;
}

export async function createContactMessage(input: {
  firstName: string;
  lastName: string;
  email: string;
  subject: string;
  message: string;
}) {
  const database = requireDatabase(await getDb());
  const [created] = await database.insert(contactMessages).values(input).returning({ id: contactMessages.id, createdAt: contactMessages.createdAt });
  if (!created) throw new Error("Contact message could not be stored.");
  return { stored: true as const, id: created.id, createdAt: created.createdAt };
}

export async function createNewsletterSubscription(email: string, source: "newsletter" | "waitlist") {
  const database = requireDatabase(await getDb());
  const normalizedEmail = email.trim().toLowerCase();
  const [created] = await database.insert(newsletterSubscriptions).values({ email: normalizedEmail, source })
    .onConflictDoUpdate({ target: newsletterSubscriptions.email, set: { source, updatedAt: new Date() } })
    .returning({ id: newsletterSubscriptions.id, createdAt: newsletterSubscriptions.createdAt });
  if (!created) throw new Error("Subscription could not be stored.");
  return { stored: true as const, id: created.id, createdAt: created.createdAt };
}

export async function listContactMessages(input: { search?: string; status?: "new" | "in_progress" | "resolved"; limit?: number; offset?: number } = {}) {
  const database = requireDatabase(await getDb());
  const limit = Math.min(Math.max(input.limit ?? 25, 1), MAX_PAGE_SIZE);
  const offset = Math.min(Math.max(input.offset ?? 0, 0), 100_000);
  const search = input.search?.trim();
  const where = and(
    input.status ? eq(contactMessages.status, input.status) : undefined,
    search ? or(ilike(contactMessages.email, `%${search}%`), ilike(contactMessages.subject, `%${search}%`), ilike(contactMessages.message, `%${search}%`)) : undefined,
  );
  const [items, total] = await Promise.all([
    database.select().from(contactMessages).where(where).orderBy(desc(contactMessages.createdAt), desc(contactMessages.id)).limit(limit).offset(offset),
    database.select({ count: sql<number>`count(*)::int` }).from(contactMessages).where(where),
  ]);
  return { items, total: Number(total[0]?.count ?? 0), offset, limit };
}

export async function updateContactMessageStatus(id: number, status: "new" | "in_progress" | "resolved") {
  const database = requireDatabase(await getDb());
  const [updated] = await database.update(contactMessages).set({ status, updatedAt: new Date() }).where(eq(contactMessages.id, id)).returning();
  if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Contact message not found." });
  return updated;
}

const recentSubmissionByIp = new Map<string, number>();
const recentSubmissionByEmail = new Map<string, number>();
const RATE_WINDOW_MS = 60_000;
function enforcePublicRateLimit(kind: string, ip: string, email: string) {
  const now = Date.now();
  for (const [key, timestamp] of recentSubmissionByIp) if (now - timestamp > RATE_WINDOW_MS) recentSubmissionByIp.delete(key);
  for (const [key, timestamp] of recentSubmissionByEmail) if (now - timestamp > RATE_WINDOW_MS) recentSubmissionByEmail.delete(key);
  const ipKey = `${kind}:${ip}`;
  const emailKey = `${kind}:${email.toLowerCase()}`;
  if (recentSubmissionByIp.has(ipKey) || recentSubmissionByEmail.has(emailKey)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait a minute before submitting again." });
  }
  recentSubmissionByIp.set(ipKey, now);
  recentSubmissionByEmail.set(emailKey, now);
}

const contactSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320),
  subject: z.string().trim().min(2).max(180),
  message: z.string().trim().min(10).max(5_000),
}).strict();
const subscriptionSchema = z.object({
  email: z.string().trim().email().max(320),
  source: z.enum(["newsletter", "waitlist"]).default("newsletter"),
}).strict();

export const publicSubmissionsRouter = router({
  contact: publicProcedure.input(contactSchema).mutation(async ({ ctx, input }) => {
    const parsed = contactSchema.parse(input);
    const ip = String(ctx.req.headers["x-forwarded-for"] ?? ctx.req.socket.remoteAddress ?? "unknown").split(",")[0]!.trim();
    enforcePublicRateLimit("contact", ip, parsed.email);
    return createContactMessage(parsed);
  }),
  subscribe: publicProcedure.input(subscriptionSchema).mutation(async ({ ctx, input }) => {
    const parsed = subscriptionSchema.parse(input);
    const ip = String(ctx.req.headers["x-forwarded-for"] ?? ctx.req.socket.remoteAddress ?? "unknown").split(",")[0]!.trim();
    enforcePublicRateLimit("subscribe", ip, parsed.email);
    return createNewsletterSubscription(parsed.email, parsed.source);
  }),
});

export const adminSubmissionsRouter = router({
  contactMessages: adminProcedure.input(z.object({
    search: z.string().trim().max(120).optional(),
    status: z.enum(["new", "in_progress", "resolved"]).optional(),
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).max(100_000).default(0),
  }).strict()).query(({ input }) => listContactMessages(input)),
  updateContactStatus: adminProcedure.input(z.object({
    id: z.number().int().positive(),
    status: z.enum(["new", "in_progress", "resolved"]),
  }).strict()).mutation(({ input }) => updateContactMessageStatus(input.id, input.status)),
});
