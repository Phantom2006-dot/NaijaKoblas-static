# NaijaKoblas TODO

## Built in code

- Clerk is the sole user-authentication provider. The React app has Clerk sign-in/sign-up routes for email/password, and the Express API verifies Clerk session tokens carried to tRPC as Bearer tokens. The application never stores a password or password hash.
- Clerk middleware is enabled only with both server keys and a validated exact public origin. Production origins must use HTTPS; partial server-key pairs, missing origin with Clerk enabled, or invalid origins fail startup rather than creating a verifier without an authorized party. With both keys absent, storefront and health routes remain available and account access stays disabled.
- The browser checks an uncached public auth-status endpoint and mounts Clerk only when the Vercel key exactly matches the API publishable key. Auth widgets and sign-out hooks are not rendered outside the matching provider.
- Every authenticated API request fetches the authoritative Clerk profile and requires its current primary email to be verified before account lookup/synchronization or owner admin bootstrap. The backend returns a clear precondition error for an unverified identity.
- Clerk identity sync writes only identity fields and never sets application roles. Customer/seller/staff/admin role checks and one-time, audited first-admin bootstrap remain database-controlled and bound to an exact configured Clerk user ID.
- Customer, seller, staff and administrator operations remain protected and owner-scoped. Seller review, staff/admin changes, per-line fulfillment, payment recovery and manual admin reconciliation remain in place.
- The Neon/Postgres schema covers accounts, profiles, seller applications/stores/listings, orders, item snapshots, Paystack transactions and per-line fulfillment. The approved baseline is applied to the empty London Free-plan test project; no production data or legacy MySQL rows were copied.
- Customer checkout calculates server prices, reserves inventory transactionally and binds idempotency keys to canonical payloads. Paystack hosted checkout/webhooks/payment verification are implemented in test mode only; provider secrets are not configured.
- The public catalog reads only published, in-stock listings from active seller stores. Customers have private order history; sellers can manage their own listings and fulfillment, including limited fulfillment-only access after suspension.

## Live test deployments

- Vercel project `naijakoblas-static` is live at [https://naijakoblas-static.vercel.app](https://naijakoblas-static.vercel.app). It builds from GitHub `main`, serves the static Vite frontend and keeps preview deployments protected. The production alias is public.
- Fly app `naijakoblas-static` runs in Amsterdam on one `shared-cpu-1x` 512 MB machine with port 3000, health checks, auto-start and stop-on-idle. A shared IPv4 is assigned; no dedicated IPv4 was allocated.
- Fly’s Neon `DATABASE_URL` and `APP_BASE_URL=https://naijakoblas-static.vercel.app` are configured. The Vercel same-origin `/api/*` rewrite reaches Fly; API health and the Neon-backed catalog have returned HTTP 200. The test catalog is empty.
- GitHub `main` is the source for Vercel production deployments. Hardened Clerk code is prepared for deployment, but no Clerk keys are configured and live authentication cannot be verified yet. When both API keys are absent, auth status reports unavailable without exposing credentials; a partial/mis-originated Clerk config fails startup.
- The old Fly app `naijakoblas-api-test` still has an unused staged database secret. A generated `MANUS_JWT_SECRET` remains on the selected app but is obsolete and should be removed after the Clerk image is deployed and verified.

## Blockers and pre-launch work

- Clerk keys and instance settings are not configured: set matching test `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` in Fly Secrets, set the same public key as `VITE_CLERK_PUBLISHABLE_KEY` in Vercel Production, enable email/password and required email verification in Clerk, and allow the exact `https://naijakoblas-static.vercel.app` origin. Until the two deployments are configured and tested, sign-in cannot be verified end to end.
- After the owner signs up, set the exact Clerk `user_…` ID as `OWNER_CLERK_USER_ID` in Fly Secrets; trigger an authenticated request and confirm the one-time administrator bootstrap. Do not guess or publish the identity.
- Paystack is not configured. Add a test-mode secret, verify Nigerian cards/bank transfer/USSD in the merchant dashboard, configure the Vercel-proxied webhook URL, and test hosted checkout, verification, retries, webhook signatures and inventory release.
- Remove the old app’s unused staged Neon secret only after confirming it is no longer needed; never copy a secret from Fly logs or output.
- Seller subaccounts/multi-split, commission accounting and payouts remain unimplemented. Define fee/commission, bank verification, refunds, chargebacks, settlement and reconciliation policy first.
- Pending inventory releases only after provider-verified failure, abandonment or reversal. Scheduled reconciliation and escalation for ambiguous transactions, refund/return workflows, support/disputes, shipping, customer notifications and image storage remain open.
- Validation passes after the auth hardening: TypeScript, 12 test files/57 tests, production app build, static Vercel build, whitespace check and local health/auth-status smoke checks. The static bundle contains no Clerk secret, Neon connection string or Paystack key. Remote deployment and live Clerk login remain unverified.

## Next

1. Push the reviewed Clerk changes to GitHub `main`, redeploy the API image to the existing Fly app and allow Vercel to rebuild from the same commit.
2. Create/select a Clerk test application; enable email/password and require email verification. Add the test publishable key to Vercel as `VITE_CLERK_PUBLISHABLE_KEY`; add that exact key as Fly `CLERK_PUBLISHABLE_KEY` plus its matching server-only `CLERK_SECRET_KEY`. Keep `APP_BASE_URL` set to the exact HTTPS Vercel origin and allow it in Clerk.
3. Verify registration, required email verification, login, logout, password reset, Bearer-authenticated account sync and role-protected routes through Vercel.
4. Set `OWNER_CLERK_USER_ID` only after the owner’s exact Clerk ID is known; confirm the first-admin audit/bootstrap using the empty test database.
5. Remove unused `MANUS_JWT_SECRET` from Fly after the Clerk deployment is confirmed; remove the old app’s staged Neon secret after confirming it is unused.
6. Add Paystack test keys and webhook setup, then test payment and inventory transitions. Keep live payments and vendor payouts disabled.
7. Define seller settlement policy before implementing subaccounts/multi-split; add scheduled reconciliation, refunds/returns and operational support before launch.
