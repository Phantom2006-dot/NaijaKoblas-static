import { SignIn, useAuth } from "@clerk/react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { useAuthRuntime } from "@/_core/auth-runtime";
import { naijaKoblasClerkAppearance } from "@/auth-appearance";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { NotificationBell } from "@/components/store/NotificationBell";
import { AdminDashboardPage } from "./AccountPages";
import { StaffProductIntakePanel } from "./StaffProductIntakePanel";

function AdminStatusPage({ title, message, children }: { title: string; message: string; children?: React.ReactNode }) {
  return <main className="admin-entry"><section className="admin-entry-card"><span className="eyebrow">NaijaKoblas · Private operations</span><ShieldCheck size={28} /><h1>{title}</h1><p>{message}</p>{children}</section></main>;
}

export function AdminAccessPage() {
  const runtime = useAuthRuntime();
  if (runtime.status === "checking") {
    return <AdminStatusPage title="Checking secure access" message="Confirming that the marketplace API and Clerk application are ready." />;
  }
  if (runtime.status !== "ready") {
    return <AdminStatusPage title="Admin sign-in unavailable" message="The website and API do not currently share a ready Clerk configuration. No admin credentials were accepted.">
      <Link className="button button--outline" href="/">Return to storefront <ArrowRight size={16} /></Link>
    </AdminStatusPage>;
  }
  return <ClerkAdminGate />;
}

function ClerkAdminGate() {
  const runtime = useAuthRuntime();
  const { theme } = useTheme();
  const { isLoaded, isSignedIn } = useAuth();
  const appearance = naijaKoblasClerkAppearance(theme);
  const account = trpc.auth.me.useQuery(undefined, {
    enabled: isLoaded && Boolean(isSignedIn),
    retry: false,
  });

  if (!isLoaded) {
    return <AdminStatusPage title="Loading secure sign-in" message="Clerk is checking the current session." />;
  }
  if (!isSignedIn) {
    return <main className="admin-entry"><section className="admin-entry-card admin-entry-card--signin">
      <span className="eyebrow">NaijaKoblas · Private operations</span><ShieldCheck size={28} />
      <h1>Administrator sign-in</h1>
      <p>This separate entry is for the designated administrator account. Staff access is managed after an administrator signs in.</p>
      <div className="admin-clerk-signin"><SignIn routing="hash" forceRedirectUrl="/admin" fallbackRedirectUrl="/admin" signUpUrl="/signup" appearance={appearance} /></div>
      <Link className="admin-return-link" href="/">Return to storefront</Link>
    </section></main>;
  }
  if (account.isLoading) {
    return <AdminStatusPage title="Verifying administrator role" message="Your Clerk session is being matched to the marketplace account and its server-side role." />;
  }
  if (account.error || !account.data) {
    return <AdminStatusPage title="Administrator access could not be verified" message="No administrator data was opened. Retry the account check or return to the storefront.">
      <button className="button button--dark" onClick={() => void account.refetch()}>Retry role check <ArrowRight size={16} /></button>
      <Link className="admin-return-link" href="/">Return to storefront</Link>
    </AdminStatusPage>;
  }
  if (account.data.role !== "admin") {
    return <AdminStatusPage title="This account has no admin access" message="This Clerk account can continue using its customer or seller workspace, but it cannot open administration tools.">
      <Link className="button button--outline" href="/account">Open my account <ArrowRight size={16} /></Link>
      <button className="text-button" disabled={!runtime.signOut} onClick={() => { if (runtime.signOut) void runtime.signOut(); }}>Sign out</button>
    </AdminStatusPage>;
  }
  return <><div className="admin-entry-topbar"><Link href="/">Return to storefront</Link><div className="admin-entry-actions"><NotificationBell /><button type="button" className="text-button" disabled={!runtime.signOut} onClick={() => { if (runtime.signOut) void runtime.signOut(); }}>Sign out</button></div></div><AdminDashboardPage /><StaffProductIntakePanel /></>;
}
