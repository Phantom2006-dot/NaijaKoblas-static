import { SignIn, SignUp, useAuth } from "@clerk/react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { safeAuthReturnTo } from "@/const";
import { useAuthRuntime } from "@/_core/auth-runtime";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";

const appearance = {
  variables: {
    colorPrimary: "#a9c847",
    colorTextOnPrimaryBackground: "#1b1b18",
    borderRadius: "0.5rem",
    fontFamily: "inherit",
  },
};

export function AuthPage({ signup = false }: { signup?: boolean }) {
  const runtime = useAuthRuntime();
  if (runtime.status !== "ready") return <ClerkSetupNotice status={runtime.status} />;
  return <ClerkAuthFlow signup={signup} />;
}

function ClerkSetupNotice({ status }: { status: string }) {
  const { theme } = useTheme();
  const message = status === "checking"
    ? "Checking the secure sign-in configuration for this deployment."
    : status === "server-unconfigured"
      ? "The marketplace API does not have its Clerk sign-in configuration yet."
      : status === "client-unconfigured"
        ? "The storefront does not have its public Clerk sign-in key yet."
        : status === "key-mismatch"
          ? "The storefront and marketplace API are configured for different Clerk applications."
          : "The storefront could not confirm that secure sign-in is available. Please try again later.";

  return <main>
    <div className="auth-localbar container-wide"><img src={theme === "dark" ? "/naija-koblas-logo-white.png" : "/naija-koblas-logo-light.png"} alt="Naija Koblas" /><Link href="/">← Back to Home</Link></div>
    <section className="auth-reference-layout container-wide"><div className="auth-card">
      <span className="eyebrow">Account sign-in</span><h1>Authentication is being configured.</h1>
      <p>{message} The public storefront remains available, but account actions require the same Clerk application on the website and API.</p>
      <Link className="button button--dark button--full" href="/">Return to the storefront <ArrowRight size={17} /></Link>
    </div><aside className="auth-benefits"><h2>One account.<br />Trusted access.</h2><ul><li><ShieldCheck size={18} />Verified email and password sign-in</li><li><ShieldCheck size={18} />Password recovery handled by Clerk</li><li><ShieldCheck size={18} />Seller and administrator roles stay server-protected</li></ul></aside></section>
  </main>;
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

  return <main>
    <div className="auth-localbar container-wide"><img src={theme === "dark" ? "/naija-koblas-logo-white.png" : "/naija-koblas-logo-light.png"} alt="Naija Koblas" /><Link href="/">← Back to Home</Link></div>
    <section className="auth-reference-layout container-wide">
      <div className="auth-card clerk-auth-card">
        {emailVerificationRequired ? <><span className="eyebrow">Email verification required</span><h1>Verify your primary email.</h1><p>NaijaKoblas requires a verified primary email before creating or accessing a marketplace account. Complete verification with Clerk, then return and refresh this page.</p>{runtime.isSignedIn && <button type="button" className="text-button" onClick={() => { if (runtime.signOut) void runtime.signOut(); }}>Sign out</button>}</>
          : !isLoaded ? <><span className="eyebrow">Secure account</span><h1>Connecting to Clerk…</h1><p>Preparing secure sign-in.</p></>
            : isSignedIn ? account.isLoading ? <><span className="eyebrow">Your account</span><h1>Finishing account setup…</h1><p>Connecting your verified Clerk identity to your NaijaKoblas account.</p></>
              : account.error ? <><span className="eyebrow">Account connection</span><h1>We could not load your account.</h1><p>Authentication succeeded, but the marketplace account service could not be reached. Please try again shortly.</p><Link className="button button--dark button--full" href="/">Return to the storefront <ArrowRight size={17} /></Link></>
                : account.data ? <><span className="eyebrow">Signed in securely</span><h1>Welcome{account.data.name ? `, ${account.data.name}` : " back"}.</h1><p>Your NaijaKoblas role is <strong>{account.data.role}</strong>. Access is assigned on the server.</p><Link className="button button--dark button--full" href={returnTo}>{returnTo === "/account" ? portal[0] : "Continue"} <ArrowRight size={17} /></Link></>
                  : <><span className="eyebrow">Account connection</span><h1>Your profile is not ready yet.</h1><p>Clerk signed you in, but the backend did not return a NaijaKoblas account. Please retry once or contact support.</p><Link className="button button--dark button--full" href="/">Return to the storefront <ArrowRight size={17} /></Link></>
            : <><span className="eyebrow">{signup ? "Join NaijaKoblas" : "Welcome back"}</span><h1>{signup ? "Create your account" : "Sign in securely"}</h1><p>Your Clerk account handles password sign-in, email verification and password recovery. Marketplace roles remain stored and controlled by NaijaKoblas.</p>
              <div className="clerk-auth-widget">{signup
                ? <SignUp routing="hash" signInUrl={signInUrl} forceRedirectUrl={returnTo} fallbackRedirectUrl={returnTo} appearance={appearance} />
                : <SignIn routing="hash" signUpUrl={signUpUrl} forceRedirectUrl={returnTo} fallbackRedirectUrl={returnTo} appearance={appearance} />}</div>
              <p className="auth-switch">{signup ? "Already registered?" : "New here?"} <Link href={signup ? signInUrl : signUpUrl}>{signup ? "Sign in" : "Create an account"}</Link></p>
            </>}
      </div>
      <aside className="auth-benefits"><h2>One account.<br />Trusted access.</h2><ul><li><span>01</span>Shop authentic Nigerian leather goods</li><li><span>02</span>Apply to sell from your verified identity</li><li><span>03</span>Staff and administrator roles stay server-protected</li><li><span>04</span>Password recovery stays with Clerk</li></ul></aside>
    </section>
  </main>;
}
