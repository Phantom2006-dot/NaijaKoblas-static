import { describe, expect, it } from "vitest";
import { isSafeNotificationHref, notificationEventKey } from "./notifications";

describe("marketplace notification helpers", () => {
  it("accepts same-origin paths and query strings", () => {
    expect(isSafeNotificationHref("/account")).toBe(true);
    expect(isSafeNotificationHref("/seller?tab=orders")).toBe(true);
  });

  it("rejects external, protocol-relative and malformed navigation targets", () => {
    for (const value of ["https://evil.example/", "//evil.example/", "javascript:alert(1)", "\\\\evil.example", "/account\n", ""]) {
      expect(isSafeNotificationHref(value)).toBe(false);
    }
  });

  it("creates deterministic, bounded event keys", () => {
    expect(notificationEventKey("order", 14, "paid")).toBe("order:14:paid");
    expect(notificationEventKey("x".repeat(250))).toHaveLength(200);
    expect(notificationEventKey("x".repeat(250), "first")).not.toBe(notificationEventKey("x".repeat(250), "second"));
  });
});
