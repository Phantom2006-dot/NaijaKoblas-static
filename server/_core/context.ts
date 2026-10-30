import { parse as parseCookieHeader } from "cookie";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { COOKIE_NAME } from "@shared/const";
import { HttpError } from "@shared/_core/errors";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const authorization = opts.req.headers.authorization;
  const hasBearerToken = typeof authorization === "string" && authorization.startsWith("Bearer ");
  const cookieValues = parseCookieHeader(opts.req.headers.cookie ?? "");
  const hasSessionCookie = Boolean(cookieValues[COOKIE_NAME] || cookieValues.app_session_id);
  let user: User | null = null;

  if (hasBearerToken || hasSessionCookie) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch (error) {
      if (error instanceof HttpError && (error.statusCode === 401 || error.statusCode === 403)) {
        user = null;
      } else {
        throw error;
      }
    }
  }

  return { req: opts.req, res: opts.res, user };
}
