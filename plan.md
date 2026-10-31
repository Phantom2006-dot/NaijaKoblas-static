# NaijaKoblas implementation plan

## Storefront and runtime boundary

The React storefront is connected to the authenticated tRPC backend for catalog, checkout, payment confirmation, customer order history and seller workspace operations. The supplied ZIP backend remains merged additively with the original storefront and Git history. `vercel.json` now configures a static Vite build and proxies `/api/*` to the Fly test API; the Vercel project has not yet been created or deployed. The Fly app record `naijakoblas-api-test` exists, but no application image or machine is deployed yet. The target API configuration is one London shared 512 MB machine with stop-on-idle and automatic start.

## Identity, roles and first administrator

A person signs in through OAuth and has one database-backed account. Ordinary accounts begin as `customer`; seller capability follows a reviewed seller application. `staff` and `admin` capability changes are protected and audited. Procedures enforce access and seller/customer ownership on the server; owner IDs are not accepted from the browser.

The first administrator is granted only after the owner has completed OAuth and the exact server-returned identity is configured as `OWNER_OPEN_ID`. A transaction lock, one-time bootstrap marker, no-existing-admin check and audit event protect that action. The identity has not been configured; do not guess it or add a public promotion route.

## Neon/Postgres and migrations

The app uses Drizzle ORM with `pg.Pool` and Neon PostgreSQL. Runtime reads pooled `DATABASE_URL`; Drizzle Kit prefers direct `DATABASE_URL_UNPOOLED`. PostgreSQL migrations live in `drizzle/postgres/`. Historical MySQL migrations remain legacy and are not applied by the new configuration.

The fresh baseline covers accounts, seller applications/stores, seller listings, customer profiles, orders, immutable order-item snapshots, Paystack payment references and per-item fulfillment. The user-approved baseline has been applied to the new empty Neon Free-plan test project in London. This is test data only: no production database was changed, no old MySQL rows were copied, and any preservation requires a separately planned export/transform/import.

## Customer commerce and seller ownership

The buyer catalog exposes only published, in-stock products from active stores. Customer checkout sends product IDs, quantities, sizes, delivery details and a customer-scoped idempotency key—not client prices or totals. The server locks product/store rows, checks stock, reserves inventory in a transaction, binds the key to a canonical payload, snapshots seller ownership and calculates totals in integer kobo.

The customer UI uses server catalog prices and redirects to hosted payment; the account UI shows private order history and only exposes a trusted Paystack URL for pending orders. Seller dashboard procedures allow only the signed-in seller to create/manage owned listings and update fulfillment on their paid line items. Seller suspension removes catalog access but permits a narrow owner-scoped route to finish already-paid order lines. Seller orders expose shipping details needed for fulfilment, not customer email or payment data. Administrators can manually re-verify pending Paystack payments; manual state changes are actor-audited. Line transitions are monotonic (`unfulfilled` → `processing` → `shipped` → `fulfilled`); overall order fulfillment is derived across sellers.

## Paystack checkout and vendor settlement

The backend initializes Paystack transactions server-side from the persisted order total in kobo. The browser receives only a trusted `checkout.paystack.com` URL; this app never collects card details. Paystack’s signed raw-body webhook and the customer return flow’s server-side transaction verification require the unique stored transaction reference, exact amount and NGN currency before the order is marked paid. Optional metadata is diagnostic only and may arrive as an object, a JSON string or be omitted. Verified failed/abandoned/reversed transactions release stock while an order remains pending; ambiguous timeouts keep the order pending for safe reconciliation.

Paystack’s official documentation describes Nigeria-relevant channels and subaccounts/multi-split transactions across multiple vendors. This application currently charges the marketplace merchant account only. It does not create vendor subaccounts or execute splits. Before implementing settlement, define the platform commission, fee bearer, seller bank verification, refund/chargeback handling and reconciliation policy; confirm enabled methods and account eligibility in the actual Paystack Dashboard. Never describe vendor payouts as active before test-mode and settlement verification.

## Deployment, database validation and remaining work

The Fly GitHub launch created the selected app `naijakoblas-static` in Amsterdam and built its image. The first deployment used Fly’s generated port 8080 instead of the application’s port 3000 and reported a public IPv6 allocation error. The resulting machine was stopped. The repository’s `fly.toml` and Vercel proxy now target `naijakoblas-static` and the correct port; redeploy is still required. The Neon `DATABASE_URL` remains staged on the old app `naijakoblas-api-test` and cannot be read/copied from Fly, so the user must enter it directly into the new app’s secret vault. The Vercel project remains to be created/deployed.

After re-entering the database secret, deploy the existing image with the corrected port, one 512 MB machine and stop-on-idle. Confirm public IP allocation, `/api/health` and a database-backed catalog query. Then deploy Vercel and test the same-origin proxy. Manus OAuth settings, Paystack test credentials and the final Vercel `APP_BASE_URL` still need configuration. Keep live commerce disabled until test-mode checkout, webhook handling and seller-money policy are verified.

Before launch, automate scheduled reconciliation and escalation for abandoned/ambiguous transactions, implement refund/return and support/dispute workflows, seller commission and eligible payout accounting, image upload/storage, shipping-carrier integration and transactional customer notifications. Keep live commerce disabled until the Express backend is deployed with HTTPS, correct CORS/cookie/OAuth configuration, configured Paystack test webhooks and verified seller-money policy.
