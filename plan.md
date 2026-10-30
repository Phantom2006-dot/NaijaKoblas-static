# NaijaKoblas implementation plan

## Storefront and runtime boundary

The React storefront is connected to the authenticated tRPC backend for catalog, checkout, payment confirmation, customer order history and seller workspace operations. The supplied ZIP backend remains merged additively with the original storefront and Git history. The current GitHub/Vercel configuration still serves a static SPA only; it does not deploy the Express API. A public build-time `VITE_API_BASE_URL` lets the storefront reach a separately hosted API, whose CORS allowlist is tied to the configured storefront origin.

## Identity, roles and first administrator

A person signs in through OAuth and has one database-backed account. Ordinary accounts begin as `customer`; seller capability follows a reviewed seller application. `staff` and `admin` capability changes are protected and audited. Procedures enforce access and seller/customer ownership on the server; owner IDs are not accepted from the browser.

The first administrator is granted only after the owner has completed OAuth and the exact server-returned identity is configured as `OWNER_OPEN_ID`. A transaction lock, one-time bootstrap marker, no-existing-admin check and audit event protect that action. The identity has not been configured; do not guess it or add a public promotion route.

## Neon/Postgres and migrations

The app uses Drizzle ORM with `pg.Pool` and Neon PostgreSQL. Runtime reads pooled `DATABASE_URL`; Drizzle Kit prefers direct `DATABASE_URL_UNPOOLED`. PostgreSQL migrations live in `drizzle/postgres/`. Historical MySQL migrations remain legacy and are not applied by the new configuration.

The fresh baseline covers accounts, seller applications/stores, seller listings, customer profiles, orders, immutable order-item snapshots, Paystack payment references and per-item fulfillment. It applies cleanly to an ephemeral PostgreSQL-compatible engine but has not been applied to a live database. It does not copy old MySQL rows; any preservation requires a separately planned export/transform/import.

## Customer commerce and seller ownership

The buyer catalog exposes only published, in-stock products from active stores. Customer checkout sends product IDs, quantities, sizes, delivery details and a customer-scoped idempotency key—not client prices or totals. The server locks product/store rows, checks stock, reserves inventory in a transaction, binds the key to a canonical payload, snapshots seller ownership and calculates totals in integer kobo.

The customer UI uses server catalog prices and redirects to hosted payment; the account UI shows private order history and only exposes a trusted Paystack URL for pending orders. Seller dashboard procedures allow only the signed-in seller to create/manage owned listings and update fulfillment on their paid line items. Seller suspension removes catalog access but permits a narrow owner-scoped route to finish already-paid order lines. Seller orders expose shipping details needed for fulfilment, not customer email or payment data. Administrators can manually re-verify pending Paystack payments; manual state changes are actor-audited. Line transitions are monotonic (`unfulfilled` → `processing` → `shipped` → `fulfilled`); overall order fulfillment is derived across sellers.

## Paystack checkout and vendor settlement

The backend initializes Paystack transactions server-side from the persisted order total in kobo. The browser receives only a trusted `checkout.paystack.com` URL; this app never collects card details. Paystack’s signed raw-body webhook and the customer return flow’s server-side transaction verification must match the unique transaction reference, order metadata, amount and NGN currency before the order is marked paid. Verified failed/abandoned transactions release stock; ambiguous timeouts keep the order pending for safe reconciliation.

Paystack’s official documentation describes Nigeria-relevant channels and subaccounts/multi-split transactions across multiple vendors. This application currently charges the marketplace merchant account only. It does not create vendor subaccounts or execute splits. Before implementing settlement, define the platform commission, fee bearer, seller bank verification, refund/chargeback handling and reconciliation policy; confirm enabled methods and account eligibility in the actual Paystack Dashboard. Never describe vendor payouts as active before test-mode and settlement verification.

## Deployment, database validation and remaining work

No live Neon credentials, Paystack test secret, production OAuth callback or public Express API host have been supplied. The schema has not been applied to an active database and no database-backed end-to-end test has run. When credentials arrive, review the target database and legacy-data needs, apply migrations, then exercise OAuth/bootstrap, checkout retries, signed webhooks, stock reservation/release and seller ownership against it.

Before launch, automate scheduled reconciliation and escalation for abandoned/ambiguous transactions, implement refund/return and support/dispute workflows, seller commission and eligible payout accounting, image upload/storage, shipping-carrier integration and transactional customer notifications. Keep live commerce disabled until the Express backend is deployed with HTTPS, correct CORS/cookie/OAuth configuration, configured Paystack test webhooks and verified seller-money policy.
