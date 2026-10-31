# NaijaKoblas

NaijaKoblas is a Nigerian leather-goods marketplace with a React storefront, Express/tRPC API, Clerk email/password authentication, customer and seller accounts, seller-owned listings, inventory, per-line fulfillment, Neon Postgres persistence and Paystack-hosted checkout. This remains a test deployment; vendor payouts and production commerce are not enabled.

## Live test deployment

- **Storefront:** [https://naijakoblas-static.vercel.app](https://naijakoblas-static.vercel.app)
- **API host:** [https://naijakoblas-static.fly.dev](https://naijakoblas-static.fly.dev)
- **Health:** `https://naijakoblas-static.vercel.app/api/health`
- **Paystack webhook path for later test setup:** `https://naijakoblas-static.vercel.app/api/payments/paystack/webhook`

Vercel serves the static Vite storefront; its `/api/*` rewrite proxies to Fly before the SPA fallback, keeping the browser-facing frontend and API on one origin. The Vercel production alias is public and preview deployments are protected. The latest production deployment for GitHub commit `381db5181cba1dfc15955561e409a09b9dd4a3e3` is READY. The API exposes `/api/health`; the Neon-backed public catalog currently contains no products.

Fly release v6 uses image `clerk-381db51` on one `shared-cpu-1x` 512 MB machine in Amsterdam, listening on port 3000. The machine is currently stopped after smoke tests and is configured to auto-start on requests and stop when idle. A free shared IPv4 is assigned; no paid dedicated IPv4 was allocated. Fly meters compute while the machine runs. Auto-stop reduces idle compute use, but stopped root-filesystem storage and other provisioned resources may still incur charges. See [Fly pricing](https://fly.io/pricing/) and the [Fly public-networking guide](https://docs.fly.io/networking/services/).

The Neon pooled `DATABASE_URL` is connected to the empty London Free-plan test project, where the approved Postgres baseline was applied. `APP_BASE_URL` is set to the production Vercel origin. No MySQL data was copied. After Clerk image verification, the obsolete `MANUS_JWT_SECRET` was removed from the selected Fly app; its remaining configured secrets are `DATABASE_URL` and `APP_BASE_URL`. The older unused Fly app `naijakoblas-api-test` still has a staged database secret; it has not been deleted.

## Clerk email/password sign-in

The application code now uses Clerk only for user authentication. Clerk’s hosted React components provide email/password sign-up, sign-in, email verification and password recovery. NaijaKoblas does **not** store passwords or password hashes. Every authenticated API request checks the current Clerk profile and requires a verified primary email before account access, profile synchronization or first-admin bootstrap. The server keeps customer/seller/staff/admin roles in Neon and ignores identity-provider role claims.

Clerk is not configured yet, so login cannot be tested until keys and the Clerk instance are set up:

1. Create or select a **test/development** Clerk application. Enable email address + password sign-up, require email verification, and leave social login off if password-only login is desired.
2. Add `VITE_CLERK_PUBLISHABLE_KEY` to the Vercel project’s **Production** environment and redeploy. This `pk_test_…` value is public and belongs in the frontend build, not in a private browser form.
3. Add the same publishable key as `CLERK_PUBLISHABLE_KEY` and its matching test `CLERK_SECRET_KEY` to Fly’s protected Secrets for `naijakoblas-static`. Do not paste keys into Git, `.env.example`, source files or chat.
4. Add `https://naijakoblas-static.vercel.app` as an allowed Clerk origin/party. `APP_BASE_URL` already points to this exact origin. The API fails startup if only one server key is set, if the public origin is missing when Clerk is enabled, or if a production origin is not HTTPS.
5. After the owner signs up, configure `OWNER_CLERK_USER_ID` with that exact Clerk user ID in Fly Secrets. The one-time first-admin bootstrap promotes only that configured customer account, only if no administrator exists, and records an audit event. Do not guess or publish this ID.

The browser checks an uncached, public `/api/auth/status` endpoint before mounting Clerk. Sign-in stays disabled unless the Vercel key exactly matches the Fly publishable key and the API confirms a complete Clerk configuration; the endpoint never returns the secret key. When both server keys are absent, public storefront routes and health checks remain available but account access is disabled. Clerk widgets never render outside a matching provider.

## Local development and database

- `pnpm install` installs the lockfile dependencies.
- `pnpm dev` starts the Express/Vite application (default port 3000).
- `pnpm build` builds the storefront and server bundle; `pnpm start` runs the production server.
- `pnpm check` and `pnpm test` run TypeScript validation and automated tests.
- `pnpm db:generate` creates a PostgreSQL migration from `drizzle/schema.ts`.
- `pnpm db:migrate` applies migrations from `drizzle/postgres/`.

Copy `.env.example` to `.env` for local work. Set `DATABASE_URL` to Neon’s pooled PostgreSQL URL for runtime queries and `DATABASE_URL_UNPOOLED` to the direct Neon URL for migrations. Keep both server-side. The checked-in `drizzle/0000_initial_users.sql` and `drizzle/0001_tense_shape.sql` are legacy MySQL history and must not be applied to Neon; the PostgreSQL baseline is isolated in `drizzle/postgres/`.

## Paystack checkout and seller money flow

Paystack remains unconfigured; do not accept test or live charges until a test `PAYSTACK_SECRET_KEY` and webhook endpoint are added. The server creates pending orders from live database listings, calculates totals in integer kobo, reserves stock and binds retry keys to canonical checkout payloads. The browser is redirected to Paystack-hosted checkout; NaijaKoblas never collects card number, expiry or CVV. Signed webhooks and server-side transaction verification require stored reference, amount and NGN currency to match before an order becomes paid.

A protected admin queue can manually verify pending payments; scheduled reconciliation for abandoned or ambiguous transactions remains future work. Paystack documents Nigerian card, transfer and USSD channels subject to merchant enablement. Seller subaccounts and multi-split transactions are not implemented: payments currently settle to the marketplace account. Define commission, fees, bank verification, refunds/chargebacks and reconciliation policy before routing funds to vendors. See [backend research and official sources](backend-research.md).

The buyer storefront uses the server catalog and hosted checkout; customer accounts show order history and resumable pending payment links. Seller tools cover listings, stock and per-item fulfillment. Suspended sellers retain a limited path to complete already-paid order lines. Refund/return workflows, notification delivery, image storage, shipping-carrier integration, seller commission accounting and automated payouts remain future work.
