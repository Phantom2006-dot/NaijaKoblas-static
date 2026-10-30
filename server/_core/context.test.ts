import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { ForbiddenError } from "@shared/_core/errors";
import { createContext } from "./context";
import { sdk } from "./sdk";

afterEach(() => vi.restoreAllMocks());

function options(headers: Record<string, string> = {}) {
  return { req: { headers, path: "/api/trpc/auth.me" }, res: {} } as CreateExpressContextOptions;
}

describe("optional request authentication", () => {
  it("does not call OAuth or the database for a public request with no credentials", async () => {
    const authenticate = vi.spyOn(sdk, "authenticateRequest");
    const context = await createContext(options());
    expect(context.user).toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("treats an explicitly invalid session as anonymous", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockRejectedValue(ForbiddenError("Invalid session cookie"));
    const context = await createContext(options({ cookie: "webdev_app_session=invalid" }));
    expect(context.user).toBeNull();
  });

  it("surfaces database and infrastructure failures instead of returning an anonymous user", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockRejectedValue(new Error("database unavailable"));
    await expect(createContext(options({ authorization: "Bearer valid-shaped-token" })))
      .rejects.toThrow("database unavailable");
  });
});
