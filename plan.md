# NaijaKoblas implementation plan

## Storefront and runtime boundary

Use the existing React storefront with the Express/tRPC backend. Vercel serves the static Vite build at `https://naijakoblas-static.vercel.app`; its `/api/*` rewrite forwards API, OAuth and webhook requests to `https://naijakoblas-static.fly.dev` before the SPA fallback. This same-origin arrangement preserves session-cookie behavior. The Vercel production deployment is READY and public, with preview deployments protected.

Fly runs the API in Amsterdam on a single `shared-cpu-1x` 512 MB machine listening on port 3000. HTTPS health checks and auto-start/stop-on-idle are configured; a free shared IPv4 is assigned. The backend exposes `/api/health` and the tRPC API. Public health and catalog checks return HTTP 200 through both the Fly host and Vercel proxy. The catalog is currently empty.

## Identity, roles and first administrator

A person signs in through Manus OAuth and has one database-backed account. Ordinary accounts begin as `customer`; seller capability follows a reviewed seller application. `staff` and `admin` capability changes are protected and audited. Procedures enforce access and seller/customer ownership on the server; owner IDs are not accepted from the browser.

The OAuth code is implemented, but the Fly environment still needs the existing Manus values `MANUS_PROJECT_ID`, `MANUS_OAUTH_API_URL` and `MANUS_OAUTH_PORTAL_URL`. The callback to register is `https://naijakoblas-static.vercel.app/api/oauth/callback`. `APP_BASE_URL` is already set to the Vercel production origin, and a server-side `MANUS_JWT_SECRET` has been generated and stored privately on Fly.

The first administrator is granted only after the owner has completed OAuth and the exact server-returned identity is configured as `OWNER_OPEN_ID`. A transaction lock, one-time bootstrap marker, no-existing-admin check and audit event protect that action. The identity is not configured; do not guess it or add a public promotion route.

## Neon/Postgres and migrations

The app uses Drizzle ORM with `pg.Pool` and Neon PostgreSQL. Runtime reads pooled `DATABASE_URL`; Drizzle Kit prefers direct `DATABASE_URL_UNPOOLED`. PostgreSQL migrations live in `drizzle/postgres/`. Historical MySQL migrations remain legacy and are not applied by the new configuration.

The fresh baseline covers accounts, seller applications/stores, seller listings, customer profiles, orders, immutable order-item snapshots, Paystack payment references and per-item fulfillment. The user-approved baseline has been applied to the new empty Neon Free-plan test project in London, and the pooled URL is deployed as a private Fly secret. This is test data only: no production database was changed, no old MySQL rows were copied, and any preservation requires a separately planned export/transform/import.

## Customer commerce and seller ownership

The buyer catalog exposes only published, in-stock products from active stores. Customer checkout sends product IDs, quantities, sizes, delivery details and a customer-scoped idempotency key—not client prices or totals. The server locks product/store rows, checks stock, reserves inventory in a transaction, binds the key to a canonical payload, snapshots seller ownership and calculates totals in integer kobo.

The customer UI uses server catalog prices and redirects to hosted payment; the account UI shows private order history and only exposes a trusted Paystack URL for pending orders. Seller dashboard procedures allow only the signed-in seller to create/manage owned listings and update fulfillment on their paid line items. Seller suspension removes catalog access but permits a narrow owner-scoped route to finish already-paid order lines. Seller orders expose shipping details needed for fulfillment, not customer email or payment data. Administrators can manually re-verify pending Paystack payments; manual state changes are actor-audited. Line transitions are monotonic (`unfulfilled` → `processing` → `shipped` → `fulfilled`); overall order fulfillment is derived across sellers.

## Paystack checkout and vendor settlement

The backend initializes Paystack transactions server-side from the persisted order total in kobo. The browser receives only a trusted `checkout.paystack.com` URL; this app never collects card details. Paystack’s signed raw-body webhook and the customer return flow’s server-side transaction verification require the unique stored transaction reference, exact amount and NGN currency before the order is marked paid. Optional metadata is diagnostic only and may arrive as an object, a JSON string or be omitted. Verified failed/abandoned/reversed transactions release stock while an order remains pending; ambiguous timeouts keep the order pending for safe reconciliation.

Paystack’s official documentation describes Nigeria-relevant channels and subaccounts/multi-split transactions across multiple vendors. This application currently charges the marketplace merchant account only. It does not create vendor subaccounts or execute splits. Before implementing settlement, define the platform commission, fee bearer, seller bank verification, refund/chargeback handling and reconciliation policy; confirm enabled methods and account eligibility in the actual Paystack Dashboard. Never describe vendor payouts as active before test-mode and settlement verification. `PAYSTACK_SECRET_KEY` is not configured, so checkout is currently disabled.

## Deployment, validation and remaining work

The backend is connected to the empty Neon test database. Vercel’s public production alias is `https://naijakoblas-static.vercel.app`, and Fly’s health, anonymous auth and database-backed catalog routes return HTTP 200 through the same-origin proxy. The original GitHub Fly launch used port 8080; it was corrected to 3000, and a free shared IPv4 was allocated after the initial public-IP error. The selected Fly machine auto-starts for API use and stops when idle; compute is billed while running.

Next configure the missing Manus OAuth project/API/portal values through Fly Secrets, register the Vercel OAuth callback, establish the owner’s exact OAuth identity for `OWNER_OPEN_ID`, then add Paystack test credentials and exercise end-to-end test checkout/webhooks. Keep live commerce disabled until those tests and seller-money policy are verified. The old `naijakoblas-api-test` app still has an unused staged Neon secret; do not remove it without confirmation.

Before launch, automate scheduled reconciliation and escalation for abandoned/ambiguous transactions, implement refund/return and support/dispute workflows, seller commission and eligible payout accounting, image upload/storage, shipping-carrier integration and transactional customer notifications. Keep live commerce disabled until the deployed API has verified OAuth, Paystack test webhooks and seller-money policy.
