import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import * as db from "../db";
import { appRouter } from "../routers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("legacy seller application endpoint", () => {
  it("rejects old details payloads without creating an application", async () => {
    const createApplication = vi.spyOn(db, "createSellerApplication");
    const context = {
      req: {} as never,
      res: {} as never,
      user: { id: 7, role: "customer" } as never,
    } as TrpcContext;
    const caller = appRouter.createCaller(context);

    await expect(caller.account.submitSellerApplication({
      legalName: "Old Client User",
      email: "old-client@example.test",
      businessName: "Old Client Store",
      craftSummary: "This payload exists only to check the retired endpoint.",
      phone: "+2348000000000",
      city: "Lagos",
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(createApplication).not.toHaveBeenCalled();
  });
});
