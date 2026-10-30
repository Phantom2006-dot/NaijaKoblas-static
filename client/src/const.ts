import { OAUTH_STATE_COOKIE, encodeOAuthState } from "@shared/const";

export { COOKIE_NAME, SESSION_DURATION_MS } from "@shared/const";

// Start the Manus OAuth flow only from an event handler: it mints and binds a
// one-time nonce cookie before navigating to the provider.
export const startLogin = () => {
  const oauthPortalUrl = window.__MANUS_CONFIG__?.oauthPortalUrl;
  const appId = window.__MANUS_CONFIG__?.projectId;
  if (!oauthPortalUrl || !appId) throw new Error("Manus login is not configured");
  const redirectUri = `${window.location.origin}/api/oauth/callback`;

  const nonce = crypto.randomUUID();
  const secureContext = window.location.protocol === "https:";
  const sameSite = secureContext ? "None" : "Lax";
  const secureAttribute = secureContext ? "; Secure" : "";
  document.cookie = `${OAUTH_STATE_COOKIE}=${nonce}; Path=/; Max-Age=600; SameSite=${sameSite}${secureAttribute}`;
  const state = encodeOAuthState({ redirectUri, nonce });

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("responseType", "code");

  window.location.href = url.toString();
};
