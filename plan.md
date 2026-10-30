# NaijaKoblas implementation plan

## Storefront and runtime boundary

The craft-commerce storefront retains its current React presentation, product imagery, responsive shell and public routes. The GitHub repository now contains both that static SPA and the Express/tRPC application from the supplied ZIP. The active Vercel configuration still serves the previous static SPA only; do not treat the Express endpoints as deployed until the server runtime is connected to a public backend host.

## Identity, roles and first administrator

A person signs in through the existing OAuth flow and has one database-backed account. Ordinary accounts begin as `customer`; seller capability is added only after a seller application is reviewed. `staff` and `admin` capability are changed only by protected operations. Protected procedures enforce permissions on the server, and resource owners are taken from the authenticated request context rather than a browser-provided account ID.

The first administrator is granted only when the project owner has completed OAuth and the exact server-returned identity is configured as `OWNER_OPEN_ID`. A transaction lock, one-time bootstrap marker, no-existing-admin check and audit event protect the operation. The identity has not been configured in this code task; do not guess it or add a public promotion route.

## Neon/Postgres and migrations

The app uses Drizzle ORM with `pg.Pool` and Neon PostgreSQL. The runtime reads the pooled `DATABASE_URL`; schema migrations prefer Neon’s direct `DATABASE_URL_UNPOOLED`. PostgreSQL migrations live in `drizzle/postgres/`. The historical MySQL migrations in `drizzle/` are retained as legacy files and are not applied by the new configuration.

The Neon baseline creates account roles, seller applications and audit history, plus customer profiles, seller stores, seller-owned listings, orders, order-item snapshots and payment transactions. This is a fresh-database baseline, not a data copy from MySQL. If existing MySQL account data must be preserved, export and transform it explicitly, validate role mappings and row counts, and only then switch production traffic.

## Customer commerce and seller ownership

Customer profile, order history and payment queries are scoped by the authenticated customer account. A checkout request includes product identifiers, quantities, sizes, delivery details and a customer-scoped idempotency key, but no client prices or totals. The server resolves published products from the database, validates active seller stores and inventory, reserves stock within a transaction, snapshots each seller’s ownership and item details, and calculates shipping in integer kobo.

Seller listings default to draft and carry a non-null `sellerUserId`. Seller operations filter by that account ID. Seller order queries return only paid or fulfilled line items owned by that seller. Product management, seller fulfilment UI, customer order detail UI and abandoned-payment reservation cleanup remain follow-on work.

## Hosted payments

Paystack is the researched hosted payment candidate for the storefront’s NGN, card, bank transfer and USSD options. The backend initializes checkout with the persisted order total and returns only Paystack’s hosted URL. It does not render or store card number, expiry or CVV. Payment and order state become paid only after a signed `charge.success` webhook or server-side verification matches the persisted reference, amount and NGN currency. Payment requests are idempotent for a customer checkout attempt.

The integration is not active until a test secret, callback origin, public API host and webhook URL are configured. Before launch, add an expiration/reconciliation process for abandoned pending payments; inventory must not be released on a timer alone if the provider may already have accepted payment.

## Deployment and verification

The current Vercel rewrite sends every path to `index.html`, so it cannot serve OAuth callbacks, tRPC requests or payment webhooks. Deploy Express with the storefront, or configure a separate API host and then align API base URL, HTTPS origin, cookie/CORS policy, OAuth callback and Paystack webhook URL. Until then, keep the current checkout labelled as a preview and do not claim a successful payment.
