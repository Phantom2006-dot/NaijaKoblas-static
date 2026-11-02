import { SignIn, SignUp, useAuth } from "@clerk/react";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { safeAuthReturnTo } from "@/const";
import { useAuthRuntime } from "@/_core/auth-runtime";
import { naijaKoblasClerkAppearance } from "@/auth-appearance";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";

export function AuthPage({ signup = false }: { signup?: boolean }) {
  const runtime = useAuthRuntime();
  if (runtime.status !== "ready") return <ClerkSetupNotice status={runtime.status} />;
  return <ClerkAuthFlow signup={signup} />;
}

function AuthFrame({ children }: { children: ReactNode }) {
  return <main className="naija-auth-page">
    <section className="auth-reference-layout container-wide">
      <div className="auth-card clerk-auth-card">{children}</div>
      <BrandStoryPanel />
    </section>
  </main>;
}

function BrandStoryPanel() {
  return <aside className="auth-benefits auth-brand-panel" aria-label="NaijaKoblas brand story">
    <img className="auth-brand-panel-image" src="/naijakoblas-hero.jpg" alt="" aria-hidden="true" />
    <div className="auth-brand-panel-wash" aria-hidden="true" />
    <div className="auth-brand-content">
      <span className="auth-brand-kicker"><i /> MADE IN NIGERIA · CURATED FOR EVERYWHERE</span>
      <div className="auth-brand-stamp" aria-hidden="true"><span>NK</span><small>EST. LAGOS</small></div>
      <h2>Rooted in craft.<br /><em>Ready for everywhere.</em></h2>
      <p>Discover distinctive Nigerian leather goods, selected for the rhythm of everyday life.</p>
      <div className="auth-brand-signature"><span>CRAFT</span><span>CULTURE</span><span>COMMERCE</span></div>
    </div>
  </aside>;
}

function AuthIntro({ label, title, copy }: { label: string; title: string; copy: string }) {
  return <div className="auth-form-intro">
    <span className="auth-brand-eyebrow"><i />{label}</span>
    <h1>{title}</h1>
    <p>{copy}</p>
  </div>;
}

function ClerkSetupNotice({ status }: { status: string }) {
  const message = status === "checking"
    ? "Checking the secure sign-in configuration for this deployment."
    : status === "server-unconfigured"
      ? "The marketplace API does not have its Clerk sign-in configuration yet."
      : status === "client-unconfigured"
        ? "The storefront does not have its public Clerk sign-in key yet."
        : status === "key-mismatch"
          ? "The storefront and marketplace API are configured for different Clerk applications."
          : "The storefront could not confirm that secure sign-in is available. Please try again later.";

  return <AuthFrame>
    <AuthIntro label="NaijaKoblas account access" title="Your craft connection is being prepared." copy="One secure account for shopping, orders and your seller journey." />
    <p className="auth-page-message">{message} The storefront remains open while account access is configured.</p>
    <Link className="button button--lime button--full auth-state-button" href="/">Return to the storefront <ArrowRight size={16} /></Link>
  </AuthFrame>;
}

function ClerkAuthFlow({ signup }: { signup: boolean }) {
  const { theme } = useTheme();
  const runtime = useAuthRuntime();
  const { isLoaded, isSignedIn } = useAuth();
  const account = trpc.auth.me.useQuery(undefined, { enabled: isLoaded && Boolean(isSignedIn), retry: false });
  const returnTo = safeAuthReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
  const emailVerificationRequired = new URLSearchParams(window.location.search).get("reason") === "email-unverified"
    || account.error?.data?.code === "PRECONDITION_FAILED";
  const signInUrl = `/login?returnTo=${encodeURIComponent(returnTo)}`;
  const signUpUrl = `/signup?returnTo=${encodeURIComponent(returnTo)}`;
  const portal = account.data?.role === "seller" ? ["Seller workspace", "/seller"]
    : account.data?.role === "staff" ? ["Staff portal", "/staff"]
      : account.data?.role === "admin" ? ["Admin portal", "/admin"]
        : ["My account", "/account"];
  const appearance = naijaKoblasClerkAppearance(theme);

  return <AuthFrame>
    {emailVerificationRequired
      ? <>
          <AuthIntro label="Email verification required" title="Verify your primary email." copy="NaijaKoblas keeps every marketplace account connected to a verified identity." />
          <p className="auth-page-message">Complete the verification step with Clerk, then return here and refresh. Your seller or administrator role remains protected by NaijaKoblas.</p>
          {runtime.isSignedIn && <button type="button" className="text-button auth-inline-action" onClick={() => { if (runtime.signOut) void runtime.signOut(); }}>Sign out</button>}
        </>
      : !isLoaded
        ? <><AuthIntro label="Secure member access" title="Preparing your account." copy="Connecting to NaijaKoblas securely." /><p className="auth-page-message">Please wait while Clerk checks your current session.</p></>
        : isSignedIn
          ? account.isLoading
            ? <><AuthIntro label="Your account" title="Finishing your sign-in." copy="Your verified Clerk identity is being matched to your marketplace account." /><p className="auth-page-message">This should only take a moment.</p></>
            : account.error
              ? <><AuthIntro label="Account connection" title="We could not load your account." copy="Authentication succeeded, but the marketplace account service could not be reached." /><p className="auth-page-message">Please try again shortly or return to the store.</p><Link className="button button--lime button--full auth-state-button" href="/">Return to the storefront <ArrowRight size={16} /></Link></>
              : account.data
                ? <><AuthIntro label="Signed in securely" title={`Welcome${account.data.name ? `, ${account.data.name}` : " back"}.`} copy={`Your NaijaKoblas access is ready. Your account role is ${account.data.role}.`} /><Link className="button button--lime button--full auth-state-button" href={returnTo}>{returnTo === "/account" ? portal[0] : "Continue"} <ArrowRight size={16} /></Link></>
                : <><AuthIntro label="Account connection" title="Your profile is not ready yet." copy="Clerk signed you in, but the marketplace did not return a NaijaKoblas account." /><p className="auth-page-message">Please retry once or contact support.</p><Link className="button button--lime button--full auth-state-button" href="/">Return to the storefront <ArrowRight size={16} /></Link></>
          : <>
              <AuthIntro
                label={signup ? "Join the NaijaKoblas community" : "Secure member access"}
                title={signup ? "Find your place in the craft." : "Welcome back to the craft."}
                copy={signup
                  ? "Create one trusted account to discover makers, follow orders and begin your seller journey."
                  : "Shop Nigerian-made leather goods, track your orders or return to your seller workspace."}
              />
              <div className="clerk-auth-widget">{signup
                ? <SignUp routing="hash" signInUrl={signInUrl} forceRedirectUrl={returnTo} fallbackRedirectUrl={returnTo} appearance={appearance} />
                : <SignIn routing="hash" signUpUrl={signUpUrl} forceRedirectUrl={returnTo} fallbackRedirectUrl={returnTo} appearance={appearance} />}</div>
              <p className="auth-switch">{signup ? "Already part of NaijaKoblas?" : "New to NaijaKoblas?"} <Link href={signup ? signInUrl : signUpUrl}>{signup ? "Sign in" : "Create your account"}</Link></p>
            </>}
  </AuthFrame>;
}
