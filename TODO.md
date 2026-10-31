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

- Vercel project `naijakoblas-static` is live at [https://naijakoblas-static.vercel.app](https://naijakoblas-static.vercel.app). Production serves the static Vite storefront and proxies `/api/*` to Fly. Its bundle includes the public Clerk key.
- Fly app `naijakoblas-static` uses image `clerk-381db51`, release v7, in Amsterdam with one `shared-cpu-1x` 512 MB machine on port 3000. The machine was stopped after verification; auto-start and stop-on-idle remain enabled. A shared IPv4 is assigned; no dedicated IPv4 was allocated.
- Fly Secrets have deployed `DATABASE_URL`, `APP_BASE_URL=https://naijakoblas-static.vercel.app`, `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. No values are stored in the repository. `MANUS_JWT_SECRET` was removed; `OWNER_CLERK_USER_ID` is not set. The unused old app `naijakoblas-api-test` still has an unneeded staged Neon secret.
- Through Vercel, `/api/health` and `/api/auth/status` returned HTTP 200. The API reports Clerk configured, and its publishable key matches the Vercel frontend. The live `/login` and `/signup` routes rendered Clerk forms.
- Clerk development app `NaijaKoblas` requires email verification at sign-up by one-time code, supports email/password, has Google sign-in off, and enforces minimum 15-character passwords with compromised-password rejection. No account submission, email verification or authenticated login was performed during smoke testing.

## Blockers and pre-launch work

- First-user signup and verified-email login still need to be completed by the owner in the new Clerk app. If no account has been registered yet, use `https://naijakoblas-static.vercel.app/signup`; prior Manus OAuth sessions were not imported. Do not share passwords or verification codes.
- After the owner signs up and verifies email, set the exact Clerk `user_…` ID as `OWNER_CLERK_USER_ID` in Fly Secrets; trigger an authenticated request and confirm the one-time administrator bootstrap. Do not guess or publish the identity.
- Paystack is not configured. Add a test-mode secret, verify Nigerian cards/bank transfer/USSD in the merchant dashboard, configure the Vercel-proxied webhook URL, and test hosted checkout, verification, retries, webhook signatures and inventory release.
- Remove the old app’s unused staged Neon secret only after confirming it is no longer needed; never copy a secret from Fly logs or output.
- Seller subaccounts/multi-split, commission accounting and payouts remain unimplemented. Define fee/commission, bank verification, refunds, chargebacks, settlement and reconciliation policy first.
- Pending inventory releases only after provider-verified failure, abandonment or reversal. Scheduled reconciliation and escalation for ambiguous transactions, refund/return workflows, support/disputes, shipping, customer notifications and image storage remain open.
- Validation passes: TypeScript, 12 test files/57 tests, production app build, static Vercel build, whitespace check, AMD64 production image build, local dev smoke checks, live health/auth-readiness checks and visual login/signup form checks. Live credential entry and actual verified-email login remain to be performed by the owner; Paystack testing is also open.

## Next

1. If needed, create the owner account at `/signup`, then complete required email verification and test password sign-in at `/login`.
2. Set `OWNER_CLERK_USER_ID` to the owner’s exact Clerk ID in Fly Secrets and confirm first-admin bootstrap after an authenticated request.
3. Add Paystack test keys and webhook setup, then test payment and inventory transitions. Keep live payments and vendor payouts disabled.
4. Confirm and remove the old abandoned app’s staged Neon secret if it is no longer needed.
5. Define seller settlement policy before implementing subaccounts/multi-split; add scheduled reconciliation, refunds/returns and operational support before launch.
