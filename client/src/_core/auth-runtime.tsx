import { createContext, useContext } from "react";

export type AuthRuntimeStatus =
  | "checking"
  | "ready"
  | "server-unconfigured"
  | "client-unconfigured"
  | "key-mismatch"
  | "status-unavailable";

export type AuthRuntimeValue = {
  status: AuthRuntimeStatus;
  isLoaded: boolean;
  isSignedIn: boolean;
  signOut?: () => Promise<void>;
};

const defaultAuthRuntime: AuthRuntimeValue = {
  status: "checking",
  isLoaded: false,
  isSignedIn: false,
};

export const AuthRuntimeContext = createContext<AuthRuntimeValue>(defaultAuthRuntime);

export function useAuthRuntime() {
  return useContext(AuthRuntimeContext);
}
