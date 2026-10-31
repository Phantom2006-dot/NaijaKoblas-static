export type ClerkEnvironment = {
  clerkPublishableKey?: string | null;
  clerkSecretKey?: string | null;
  appBaseUrl?: string | null;
  isProduction?: boolean;
};

export type ClerkServerConfig = {
  enabled: boolean;
  appOrigin: string | null;
  publishableKey: string | null;
  secretKey: string | null;
  authorizedParties: string[];
};

export function parseConfiguredAppOrigin(value: string | null | undefined, isProduction: boolean): string | null {
  const configuredValue = value?.trim();
  if (!configuredValue) return null;

  let url: URL;
  try {
    url = new URL(configuredValue);
  } catch {
    throw new Error("APP_BASE_URL must be a valid absolute storefront origin.");
  }

  const hasOnlyOriginPath = url.pathname === "/";
  if (url.username || url.password || url.search || url.hash || !hasOnlyOriginPath) {
    throw new Error("APP_BASE_URL must contain only the storefront origin, without credentials, path, query, or fragment.");
  }

  const isHttps = url.protocol === "https:";
  const isLoopbackHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if (!isHttps && (isProduction || url.protocol !== "http:" || !isLoopbackHost)) {
    throw new Error("APP_BASE_URL must use HTTPS; HTTP is allowed only for localhost during development.");
  }

  return url.origin;
}

export function getClerkServerConfig(environment: ClerkEnvironment): ClerkServerConfig {
  const publishableKey = environment.clerkPublishableKey?.trim() || null;
  const secretKey = environment.clerkSecretKey?.trim() || null;
  const hasPublishableKey = Boolean(publishableKey);
  const hasSecretKey = Boolean(secretKey);

  if (hasPublishableKey !== hasSecretKey) {
    throw new Error("CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY must be configured together.");
  }

  const appOrigin = parseConfiguredAppOrigin(environment.appBaseUrl, Boolean(environment.isProduction));
  const enabled = hasPublishableKey && hasSecretKey;
  if (enabled && !appOrigin) {
    throw new Error("APP_BASE_URL is required when Clerk authentication is configured.");
  }

  return {
    enabled,
    appOrigin,
    publishableKey: enabled ? publishableKey : null,
    secretKey: enabled ? secretKey : null,
    authorizedParties: enabled && appOrigin ? [appOrigin] : [],
  };
}

export function getClerkMiddlewareOptions(config: ClerkServerConfig) {
  if (!config.enabled || !config.secretKey || !config.publishableKey || !config.appOrigin) return null;
  return {
    secretKey: config.secretKey,
    publishableKey: config.publishableKey,
    authorizedParties: [...config.authorizedParties],
  };
}

export function getPublicClerkStatus(config: ClerkServerConfig) {
  return {
    configured: config.enabled,
    publishableKey: config.enabled ? config.publishableKey : null,
  };
}
