# NaijaKoblas

NaijaKoblas is a React storefront with an Express/tRPC backend, OAuth-backed customer and seller accounts, seller-owned listings, Neon Postgres persistence, per-item fulfillment and Paystack hosted checkout integration. The code is under active development; live commerce is not enabled until database, OAuth, Paystack test credentials and seller-settlement policy are configured.

## Local commands

- `pnpm install` installs the lockfile dependencies.
- `pnpm dev` starts the Express/Vite application (default port 3000).
- `pnpm build` builds the storefront and server bundle; `pnpm start` runs the production server.
- `pnpm check` and `pnpm test` run TypeScript validation and unit tests.
- `pnpm db:generate` creates a PostgreSQL migration from `drizzle/schema.ts`.
- `pnpm db:migrate` applies migrations from `drizzle/postgres/`.

## Neon configuration

Copy `.env.example` to `.env`. Set `DATABASE_URL` to Neon’s pooled PostgreSQL URL for application traffic. Set `DATABASE_URL_UNPOOLED` to the direct Neon URL for schema migrations. Both values are secrets. The checked-in `drizzle/0000_initial_users.sql` and `drizzle/0001_tense_shape.sql` are legacy MySQL history and must not be applied to Neon; the PostgreSQL baseline is isolated in `drizzle/postgres/`.

The current Postgres baseline is a fresh schema and was validated locally, but no production database migration has been applied. It does not copy existing MySQL records. If account or seller data must be preserved, export, transform and validate it separately before switching production traffic.

## First administrator

Do not set `OWNER_OPEN_ID` until the project owner has completed OAuth and the exact server-side OAuth identity is known. Once configured as a protected server secret, the first matching customer login can become the initial administrator only if no administrator or bootstrap record exists. That one-time promotion and its audit event are transactional. No public operation accepts an owner identity or grants administrator status.

## Paystack checkout and seller money flow

The server creates customer profiles, pending orders, immutable item snapshots and Paystack payment records. Prices, inventory reservations and delivery totals are resolved from active published listings on the server in integer kobo. Customer checkout retries are bound to a stable idempotency key and canonical payload. Paystack receives the stored unique transaction reference, server total and customer email. The browser is redirected to Paystack-hosted Checkout; this site never collects card number, expiry or CVV.

Set `PAYSTACK_SECRET_KEY` and `APP_BASE_URL` only in the backend environment. Use a Paystack test key first. Configure the webhook URL as `/api/payments/paystack/webhook`. The route verifies `x-paystack-signature` over the exact raw request body. The customer return route separately calls Paystack’s transaction verification API. Payment and order state become paid only when the transaction reference, amount, currency, provider status and stored order match. A protected admin queue can manually re-check pending references with Paystack; that action records the admin actor. Verified failed/abandoned/reversed transactions release stock only while the order is still awaiting payment; an ambiguous provider timeout does not.

Paystack documents cards, Nigerian bank-transfer and USSD channels, subject to merchant-account and dashboard availability. Confirm the exact methods on the project’s Paystack test account before launch. Paystack also documents subaccounts and multi-split transfers across vendors. **This code does not yet create subaccounts or split transactions**: funds currently settle to the marketplace Paystack account. Do not promise vendor payout timing or activate automatic splits until sellers’ bank details are verified and the platform commission, transaction-fee bearer, refund/chargeback and reconciliation policy is agreed. See [backend research and official sources](backend-research.md).

The buyer storefront reads published server listings and uses hosted checkout; the customer account shows order history and resumable pending checkout links; the seller workspace supports draft/published listings, inventory edits and per-item processing/shipping/delivery updates. Suspended sellers lose catalog controls but retain a restricted path to complete already-paid fulfillment lines. Scheduled reconciliation for abandoned or ambiguous payments, refunds/returns, notification delivery, image storage, shipping-carrier integration, seller commission accounting and payouts remain future work.

## Deployment

The current GitHub/Vercel configuration is a static SPA with a catch-all rewrite to `index.html`; it cannot serve Express OAuth, tRPC or Paystack webhook routes. Deploy the Express server with the storefront or configure a separate API host. For a separate API origin, set public build-time `VITE_API_BASE_URL` in the frontend and server-side `APP_BASE_URL` to the exact storefront origin; the backend allows credentialed CORS only for that origin. Configure HTTPS, cookies, OAuth callback and the Paystack webhook before test-mode validation. The health route checks process availability only, not database readiness.
