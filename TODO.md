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
- The Fly container compiles on the build host and runs a small AMD64 Alpine image with only the API’s production runtime dependencies. Vite/dev tooling loads only for development.

## Live test deployments

- Vercel project `naijakoblas-static` is live at [https://naijakoblas-static.vercel.app](https://naijakoblas-static.vercel.app). Production is READY on GitHub commit `381db5181cba1dfc15955561e409a09b9dd4a3e3`; preview deployments remain protected.
- Fly app `naijakoblas-static` uses image `clerk-381db51`, release v6, in Amsterdam with one `shared-cpu-1x` 512 MB machine on port 3000. It is intentionally stopped after smoke tests; Fly autostarts it for requests and stops it when idle. A shared IPv4 is assigned; no dedicated IPv4 was allocated.
- The selected Fly app retains `DATABASE_URL` and `APP_BASE_URL=https://naijakoblas-static.vercel.app`. The obsolete `MANUS_JWT_SECRET` was removed after the Clerk image was deployed. The old app `naijakoblas-api-test` still has an unused staged database secret; it has not been deleted.
- Before stopping the Fly machine, direct Fly and Vercel-proxied calls to `/api/health` and `/api/auth/status` returned HTTP 200. The Vercel-proxied public catalog also returned HTTP 200 with an empty result. The Neon test catalog is empty.
- Clerk keys and the owner’s Clerk ID are not configured. The live API reports `{"configured":false,"publishableKey":null}` until the server keys are added; live sign-in cannot yet be tested. Paystack keys are also absent.

## Blockers and pre-launch work

- Clerk test-instance settings and keys are required: enable email/password and required email verification, allow the exact `https://naijakoblas-static.vercel.app` origin, set `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` in Fly Secrets, and set the same publishable key as Vercel Production `VITE_CLERK_PUBLISHABLE_KEY`. Keep the API and browser keys paired; until configured, sign-in remains unavailable.
- After the owner signs up, set the exact Clerk `user_…` ID as `OWNER_CLERK_USER_ID` in Fly Secrets; trigger an authenticated request and confirm the one-time administrator bootstrap. Do not guess or publish the identity.
- Paystack is not configured. Add a test-mode secret, verify Nigerian cards/bank transfer/USSD in the merchant dashboard, configure the Vercel-proxied webhook URL, and test hosted checkout, verification, retries, webhook signatures and inventory release.
- Remove the old app’s unused staged Neon secret only after confirming it is no longer needed; never copy a secret from Fly logs or output.
- Seller subaccounts/multi-split, commission accounting and payouts remain unimplemented. Define fee/commission, bank verification, refunds, chargebacks, settlement and reconciliation policy first.
- Pending inventory releases only after provider-verified failure, abandonment or reversal. Scheduled reconciliation and escalation for ambiguous transactions, refund/return workflows, support/disputes, shipping, customer notifications and image storage remain open.
- Validation passes: TypeScript, 12 test files/57 tests, production app build, static Vercel build, whitespace check, AMD64 production image build, local dev smoke checks, and live Fly/Vercel health/auth/catalog smoke checks. The static bundle has no Clerk secret, Neon connection string or Paystack key. Live Clerk authentication and Paystack transactions remain unverified because provider keys are not configured.

## Next

1. Configure the Clerk test instance for verified email/password and the production Vercel origin; enter the matching server and browser publishable keys in Fly and Vercel protected environments.
2. Verify sign-up, email verification, login, logout, password reset, Bearer-authenticated account sync and role-protected routes through Vercel.
3. Set `OWNER_CLERK_USER_ID` only after the owner’s exact Clerk ID is known; confirm the first-admin audit/bootstrap using the empty test database.
4. Add Paystack test keys and webhook setup, then test payment and inventory transitions. Keep live payments and vendor payouts disabled.
5. Confirm and remove the old abandoned app’s staged Neon secret if it is no longer needed.
6. Define seller settlement policy before implementing subaccounts/multi-split; add scheduled reconciliation, refunds/returns and operational support before launch.
