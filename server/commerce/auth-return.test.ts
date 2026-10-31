import { describe, expect, it } from "vitest";
import { safeAuthReturnTo } from "../../client/src/const";

describe("safe Clerk auth return paths", () => {
  it("preserves safe same-origin routes with queries and hashes", () => {
    expect(safeAuthReturnTo("/checkout?delivery=express#payment")).toBe("/checkout?delivery=express#payment");
    expect(safeAuthReturnTo("/seller")).toBe("/seller");
  });

  it("rejects external, protocol-relative, backslash and control-character destinations", () => {
    for (const path of ["https://evil.example", "//evil.example", "/\\evil.example", "/account\nLocation: https://evil.example"]) {
      expect(safeAuthReturnTo(path)).toBe("/account");
    }
  });

  it("avoids redirect loops through sign-in and sign-up", () => {
    expect(safeAuthReturnTo("/login")).toBe("/account");
    expect(safeAuthReturnTo("/signup?returnTo=/seller")).toBe("/account");
    expect(safeAuthReturnTo(undefined)).toBe("/account");
  });
});
