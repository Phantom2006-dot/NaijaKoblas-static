# NaijaKoblas TODO

## Built in code

- Customer, seller, staff and administrator access is tied to the authenticated OAuth account. Seller approval and staff/admin actions are protected and audited. Initial administrator bootstrap still requires the owner’s exact server identity.
- A fresh Neon/Postgres schema and baseline migration cover accounts, profiles, seller applications/stores, seller listings, orders, item snapshots, Paystack transactions and per-line fulfillment. The approved baseline is applied to the empty Neon Free-plan test project in London; no production data was changed or copied from legacy MySQL.
- The public catalog reads only published, in-stock listings from active seller stores. Seller listing operations are owner-scoped; stock edits are blocked while pending checkout reserves units.
- Customer checkout persists server-priced orders, stock reservations and canonical idempotency fingerprints. Paystack checkout, signed webhooks and customer verification validate the stored reference, amount, NGN currency and order data.
- Customer order history and payment recovery, seller listing/inventory tools, per-item fulfillment, suspended-seller fulfillment-only access and an actor-audited admin payment-reconciliation queue are implemented.

## Live test deployments

- Vercel project `naijakoblas-static` is READY in the Hobby team at [https://naijakoblas-static.vercel.app](https://naijakoblas-static.vercel.app). It builds from GitHub `main`, serves the static Vite frontend and keeps preview deployments protected. The production alias is public.
- Fly app `naijakoblas-static` runs in Amsterdam on one `shared-cpu-1x` 512 MB machine with port 3000, health checks, auto-start and stop-on-idle. A free shared IPv4 is assigned; no dedicated IPv4 was allocated. The public `/api/health` returns HTTP 200.
- Fly’s `DATABASE_URL`, `APP_BASE_URL=https://naijakoblas-static.vercel.app` and generated `MANUS_JWT_SECRET` are deployed. The Vercel same-origin `/api/*` rewrite reaches Fly; both health and the Neon-backed catalog return HTTP 200. The test database has no published products yet.
- The initial Fly UI launch used port 8080 and failed its health check; that attempt was corrected by deploying the existing image with port 3000. A shared IPv4 was manually assigned after the first public-IP allocation error. The old app `naijakoblas-api-test` still holds an unused staged database secret; it has not been deleted.
- GitHub `main` is the source for the live Vercel production deployment; later pushes will trigger production builds.

## Blockers and pre-launch work

- Manus OAuth code is present but Fly is still missing `MANUS_PROJECT_ID`, `MANUS_OAUTH_API_URL` and `MANUS_OAUTH_PORTAL_URL`. Register `https://naijakoblas-static.vercel.app/api/oauth/callback` with the existing Manus OAuth app. A server-side session-signing key and `APP_BASE_URL` are already configured.
- Paystack is not configured. Add a test-mode `PAYSTACK_SECRET_KEY`, verify Nigerian card/transfer/USSD availability in the merchant dashboard, and run a test transaction plus signed webhook through the Vercel-to-Fly proxy.
- `OWNER_OPEN_ID` is not set. After OAuth works, establish the project owner’s exact server identity and then configure the one-time administrator bootstrap. Do not guess the identity.
- Remove the old app’s unused staged Neon secret only after confirming it is no longer needed; the secret value must not be copied from Fly logs or output.
- Seller subaccounts and multi-split transactions are not implemented. Define commission/fee rules, verify seller bank details and agree refund/chargeback/reconciliation procedures before routing money to vendors.
- Pending inventory releases only after provider-verified failure, abandonment or reversal. Add scheduled reconciliation and escalation for ambiguous transactions before launch.
- Refund/return policy, support/dispute workflow, shipping-carrier integration, customer notifications, image storage/upload, seller commission ledger and automated payouts remain unimplemented.
- TypeScript, 43 unit tests, production build and static Vercel build pass. Live Fly health, anonymous auth, database-backed catalog and Vercel `/api/*` proxy return HTTP 200; no OAuth login or Paystack test transaction has been verified.

## Next

1. Configure the three missing Manus OAuth values through the protected Fly Secrets form; keep `MANUS_JWT_SECRET` and `APP_BASE_URL` as already deployed. Test login and the callback on the public Vercel domain.
2. Set the exact owner `OWNER_OPEN_ID` only after the owner has completed OAuth, then confirm the one-time administrator bootstrap.
3. Add the Paystack test key through Fly Secrets, configure the webhook URL in the Paystack test dashboard and test hosted checkout, signature verification, retries, payment confirmation and stock release.
4. Confirm whether to remove the staged Neon secret from the old unused Fly app; keep the one-machine Fly test service stopped/idle when not exercising API calls.
5. Agree vendor settlement policy and bank verification before implementing Paystack subaccounts/multi-split; add scheduled reconciliation, refunds/returns and operational support before launch.
