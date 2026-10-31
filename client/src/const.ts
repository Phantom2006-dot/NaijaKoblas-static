export function safeAuthReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
    return "/account";
  }
  const pathname = value.split(/[?#]/, 1)[0];
  if (pathname === "/login" || pathname === "/signup") return "/account";
  return value;
}

export function startLogin(returnTo?: string) {
  if (typeof window === "undefined") return;
  const currentRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const destination = safeAuthReturnTo(returnTo ?? currentRoute);
  window.location.assign(`/login?returnTo=${encodeURIComponent(destination)}`);
}
