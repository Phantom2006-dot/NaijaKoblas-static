import { createHash } from "node:crypto";

const APP_ORIGIN = "https://naijakoblas.invalid";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Notifications may navigate only within the application, never to attacker-controlled origins. */
export function isSafeNotificationHref(value: string): boolean {
  if (!value || value.length > 512 || !value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\") || CONTROL_CHARACTERS.test(value)) return false;
  try {
    return new URL(value, APP_ORIGIN).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

/** A stable event key makes webhook retries and repeated status callbacks harmless. */
export function notificationEventKey(...parts: Array<string | number>): string {
  const identity = parts.map(part => String(part).trim()).join(":");
  if (identity.length <= 200) return identity;
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 32);
  return `${identity.slice(0, 167)}:${digest}`;
}
