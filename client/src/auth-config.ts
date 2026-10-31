export const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? "";

export type BackendClerkStatus = {
  configured: boolean;
  publishableKey: string | null;
};

export type ClientAuthReadiness =
  | "checking"
  | "ready"
  | "server-unconfigured"
  | "client-unconfigured"
  | "key-mismatch"
  | "status-unavailable";

export function resolveClientAuthReadiness(
  clientPublishableKey: string,
  backendStatus: BackendClerkStatus | null | undefined,
): ClientAuthReadiness {
  if (backendStatus === undefined) return "checking";
  if (backendStatus === null) return "status-unavailable";
  if (!backendStatus.configured) return "server-unconfigured";
  if (!clientPublishableKey) return "client-unconfigured";
  if (!backendStatus.publishableKey || clientPublishableKey !== backendStatus.publishableKey) return "key-mismatch";
  return "ready";
}
