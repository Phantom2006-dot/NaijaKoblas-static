import { trpc } from "@/lib/trpc";
import { EMAIL_VERIFICATION_REQUIRED_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { ClerkProvider, useAuth as useClerkAuth, useClerk } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import superjson from "superjson";
import App from "./App";
import { BackendClerkStatus, clerkPublishableKey, resolveClientAuthReadiness } from "./auth-config";
import { AuthRuntimeContext, AuthRuntimeStatus } from "./_core/auth-runtime";
import { safeAuthReturnTo, startLogin } from "./const";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError) || typeof window === "undefined") return;
  const isEmailVerificationRequired = error.data?.code === "PRECONDITION_FAILED"
    && error.message === EMAIL_VERIFICATION_REQUIRED_MSG;
  if (isEmailVerificationRequired && window.location.pathname !== "/login" && window.location.pathname !== "/signup") {
    const currentRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const returnTo = safeAuthReturnTo(currentRoute);
    window.location.assign(`/login?reason=email-unverified&returnTo=${encodeURIComponent(returnTo)}`);
    return;
  }
  const isUnauthorized = error.data?.code === "UNAUTHORIZED" || error.message === UNAUTHED_ERR_MSG;
  if (!isUnauthorized || window.location.pathname === "/login" || window.location.pathname === "/signup") return;
  startLogin();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    redirectToLoginIfUnauthorized(event.query.state.error);
    console.error("[API Query Error]", event.query.state.error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    redirectToLoginIfUnauthorized(event.mutation.state.error);
    console.error("[API Mutation Error]", event.mutation.state.error);
  }
});

function TrpcApplication({ getToken }: { getToken?: () => Promise<string | null> }) {
  const trpcClient = useMemo(() => trpc.createClient({
    links: [httpBatchLink({
      url: import.meta.env.VITE_API_BASE_URL?.trim()
        ? `${import.meta.env.VITE_API_BASE_URL.trim().replace(/\/$/, "")}/api/trpc`
        : "/api/trpc",
      transformer: superjson,
      async headers() {
        try {
          const token = await getToken?.();
          return token ? { Authorization: `Bearer ${token}` } : {};
        } catch {
          return {};
        }
      },
      fetch(input, init) {
        return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
      },
    })],
  }), [getToken]);

  return <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
  </trpc.Provider>;
}

function ClerkApplication() {
  const { getToken, isLoaded, isSignedIn } = useClerkAuth();
  const clerk = useClerk();
  const runtime = useMemo(() => ({
    status: "ready" as const,
    isLoaded,
    isSignedIn: Boolean(isSignedIn),
    signOut: () => clerk.signOut({ redirectUrl: "/" }),
  }), [clerk, isLoaded, isSignedIn]);

  return <AuthRuntimeContext.Provider value={runtime}>
    <TrpcApplication getToken={getToken} />
  </AuthRuntimeContext.Provider>;
}

function RootApplication() {
  const [backendStatus, setBackendStatus] = useState<BackendClerkStatus | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const apiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, "") ?? "";
    globalThis.fetch(`${apiBase}/api/auth/status`, { credentials: "include", headers: { Accept: "application/json" } })
      .then(async response => {
        if (!response.ok) throw new Error("Auth status request failed.");
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object") throw new Error("Invalid auth status response.");
        const status = payload as Partial<BackendClerkStatus>;
        if (typeof status.configured !== "boolean"
          || !(status.publishableKey === null || typeof status.publishableKey === "string")) {
          throw new Error("Invalid auth status response.");
        }
        if (!cancelled) setBackendStatus({ configured: status.configured, publishableKey: status.publishableKey });
      })
      .catch(() => { if (!cancelled) setBackendStatus(null); });
    return () => { cancelled = true; };
  }, []);

  const readiness = resolveClientAuthReadiness(clerkPublishableKey, backendStatus);
  if (readiness === "ready") {
    return <ClerkProvider publishableKey={clerkPublishableKey}><ClerkApplication /></ClerkProvider>;
  }

  const runtimeStatus = readiness as Exclude<AuthRuntimeStatus, "ready">;
  return <AuthRuntimeContext.Provider value={{
    status: runtimeStatus,
    isLoaded: readiness !== "checking",
    isSignedIn: false,
  }}>
    <TrpcApplication />
  </AuthRuntimeContext.Provider>;
}

createRoot(document.getElementById("root")!).render(<RootApplication />);
