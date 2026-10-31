import { trpc } from "@/lib/trpc";
import { useCallback, useEffect, useMemo } from "react";
import { startLogin } from "@/const";
import { useAuthRuntime } from "../auth-runtime";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const runtime = useAuthRuntime();
  const clerkReady = runtime.status === "ready";
  const isLoaded = runtime.status !== "checking" && (!clerkReady || runtime.isLoaded);
  const isSignedIn = clerkReady && runtime.isSignedIn;
  const account = trpc.auth.me.useQuery(undefined, {
    enabled: clerkReady && isLoaded && isSignedIn,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logout = useCallback(async () => {
    await runtime.signOut?.();
  }, [runtime.signOut]);

  const state = useMemo(() => ({
    user: account.data ?? null,
    loading: runtime.status === "checking" || (clerkReady && (!isLoaded || (isSignedIn && account.isLoading))),
    error: account.error ?? null,
    isAuthenticated: Boolean(isSignedIn && account.data),
  }), [account.data, account.error, account.isLoading, clerkReady, isLoaded, isSignedIn, runtime.status]);

  useEffect(() => {
    if (!redirectOnUnauthenticated || runtime.status === "checking" || !isLoaded || isSignedIn || typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;
    startLogin(redirectPath);
  }, [isLoaded, isSignedIn, redirectOnUnauthenticated, redirectPath, runtime.status]);

  return {
    ...state,
    refresh: () => account.refetch(),
    logout,
  };
}
