# NaijaKoblas

NaijaKoblas is a Nigerian leather-goods marketplace with a React storefront, Express/tRPC API, customer and seller accounts, seller-owned listings, inventory, per-line fulfillment, Neon Postgres persistence and Paystack-hosted checkout. This is a test deployment; vendor payouts and production commerce are not enabled.

## Live test deployment

- **Storefront:** [https://naijakoblas-static.vercel.app](https://naijakoblas-static.vercel.app)
- **API host:** [https://naijakoblas-static.fly.dev](https://naijakoblas-static.fly.dev)
- **Health:** `https://naijakoblas-static.vercel.app/api/health`
- **Paystack webhook path for later test setup:** `https://naijakoblas-static.vercel.app/api/payments/paystack/webhook`

The Vercel Hobby project serves a static Vite build and protects preview deployments; its production alias is public. Its `/api/*` rewrite proxies to Fly before the SPA fallback so browser API calls and OAuth cookies use one origin. The Vercel production deployment is READY. The Fly API’s `/api/health` and Neon-backed `/api/trpc/catalog.list` both return HTTP 200; the catalog is currently empty, so no seller products are shown yet.

Fly runs one `shared-cpu-1x` 512 MB machine in Amsterdam on port 3000, with auto-start on requests and stop-on-idle. A shared IPv4 is assigned; no paid dedicated IPv4 was allocated. Fly meters compute while the Machine runs. Auto-stop reduces idle compute use, but stopped root-filesystem storage and any other provisioned resources may still incur charges. See [Fly pricing](https://fly.io/pricing/) and the [Fly public-networking guide](https://docs.fly.io/networking/services/).

The protected Fly runtime currently has `DATABASE_URL`, `APP_BASE_URL` and a server-generated `MANUS_JWT_SECRET`. The Neon pooled URL is connected to the empty test project in London, where the approved baseline schema was applied. No MySQL data was copied. The unused earlier app `naijakoblas-api-test` still has a staged database secret; it has not been deleted.

**Sign-in is not ready yet.** The Manus OAuth implementation is present, but these Fly runtime values are not configured: `MANUS_PROJECT_ID`, `MANUS_OAUTH_API_URL` and `MANUS_OAUTH_PORTAL_URL`. The OAuth callback to register is `https://naijakoblas-static.vercel.app/api/oauth/callback`. `OWNER_OPEN_ID` must be set only after the owner’s exact OAuth identity is known. Paystack is also not configured: add a test-mode `PAYSTACK_SECRET_KEY` only after the merchant test account is confirmed. Do not enable live charges or vendor payouts yet.

## Local commands

- `pnpm install` installs the lockfile dependencies.
- `pnpm dev` starts the Express/Vite application (default port 3000).
- `pnpm build` builds the storefront and server bundle; `pnpm start` runs the production server.
- `pnpm check` and `pnpm test` run TypeScript validation and unit tests.
- `pnpm db:generate` creates a PostgreSQL migration from `drizzle/schema.ts`.
- `pnpm db:migrate` applies migrations from `drizzle/postgres/`.

## Neon configuration

Copy `.env.example` to `.env` for local work. Set `DATABASE_URL` to Neon’s pooled PostgreSQL URL for application traffic. Set `DATABASE_URL_UNPOOLED` to the direct Neon URL for schema migrations. Both values are secrets and must stay server-side. The checked-in `drizzle/0000_initial_users.sql` and `drizzle/0001_tense_shape.sql` are legacy MySQL history and must not be applied to Neon; the PostgreSQL baseline is isolated in `drizzle/postgres/`.

The approved baseline is applied to the empty Neon Free-plan test project in London. No production database was changed; if existing account or seller data must be preserved, export, transform and validate it separately before switching production traffic.

## First administrator

Do not set `OWNER_OPEN_ID` until the project owner has completed OAuth and the exact server-side OAuth identity is known. Once configured as a protected server secret, the first matching customer login can become the initial administrator only if no administrator or bootstrap record exists. That one-time promotion and its audit event are transactional. No public operation accepts an owner identity or grants administrator status.

## Paystack checkout and seller money flow

The server creates customer profiles, pending orders, immutable item snapshots and Paystack payment records. Prices, inventory reservations and delivery totals are resolved from active published listings on the server in integer kobo. Customer checkout retries are bound to a stable idempotency key and canonical payload. Paystack receives the stored unique transaction reference, server total and customer email. The browser is redirected to Paystack-hosted Checkout; this site never collects card number, expiry or CVV.

After the test Paystack key is added, use the webhook URL above. The route verifies `x-paystack-signature` over the exact raw request body. The customer return route separately calls Paystack’s transaction-verification API. Payment and order state become paid only when the transaction reference, amount, currency, provider status and stored order match. A protected admin queue can manually re-check pending references with Paystack; that action records the admin actor. Verified failed/abandoned/reversed transactions release stock only while the order is still awaiting payment; an ambiguous provider timeout does not.

Paystack documents cards, Nigerian bank-transfer and USSD channels, subject to merchant-account and dashboard availability. Confirm the exact methods on the test account before launch. Paystack also documents subaccounts and multi-split transfers across vendors. **This code does not yet create subaccounts or split transactions**: funds currently settle to the marketplace Paystack account. Do not promise vendor payout timing or activate automatic splits until sellers’ bank details are verified and the platform commission, transaction-fee bearer, refund/chargeback and reconciliation policy is agreed. See [backend research and official sources](backend-research.md).

The buyer storefront reads published server listings and uses hosted checkout; the customer account shows order history and resumable pending checkout links; the seller workspace supports draft/published listings, inventory edits and per-item processing/shipping/delivery updates. Suspended sellers lose catalog controls but retain a restricted path to complete already-paid fulfillment lines. Scheduled reconciliation for abandoned or ambiguous payments, refunds/returns, notification delivery, image storage, shipping-carrier integration, seller commission accounting and payouts remain future work.
