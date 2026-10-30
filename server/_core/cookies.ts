import type { CookieOptions, Request } from "express";

function cookieTransportOptions(req: Request): Pick<CookieOptions, "secure" | "sameSite"> {
  const forwardedHeader = req.headers["x-forwarded-proto"];
  const forwardedProtocol = (Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader)
    ?.split(",")[0]?.trim();
  const secure = req.secure === true
    || req.protocol === "https"
    || forwardedProtocol === "https"
    || process.env.NODE_ENV === "production";
  return { secure, sameSite: secure ? "none" : "lax" };
}

export function getSessionCookieOptions(req: Request): CookieOptions {
  return { httpOnly: true, path: "/", ...cookieTransportOptions(req) };
}

export function getOAuthStateCookieOptions(req: Request): CookieOptions {
  return { path: "/", ...cookieTransportOptions(req) };
}
