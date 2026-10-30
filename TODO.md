# NaijaKoblas TODO

## Complete — 12. Establish real account, seller, staff and administrator backend access

- Customer, seller, staff and administrator access is based on the authenticated OAuth-backed database account. There is no browser-selected role or separate password form.
- Protected procedures enforce roles and ownership on the server. Seller application review, staff access changes and audit writes are transactional.
- Public storefront routes and separate customer, seller, staff and admin entry points are retained.
- Account and seller-review schema definitions have been converted to PostgreSQL for the new Neon database. Existing MySQL migration files remain as legacy history and are not used by the new migration configuration.

## In progress — 13. Bootstrap the first administrator safely

- A transactionally guarded, one-time bootstrap now promotes only the exact configured `OWNER_OPEN_ID` OAuth account, only when it is still a customer and no administrator/bootstrap record exists. The action writes an audit event.
- The owner must first complete OAuth. The exact server-returned identity is not known in this task, so `OWNER_OPEN_ID` has not been configured and no administrator has been provisioned.

## In progress — 14. Add server-backed customer commerce and hosted payments

- Added a fresh Neon/Postgres schema for customer profiles, seller stores, seller-owned listings, orders, immutable line snapshots and Paystack payment transactions.
- Added server procedures for seller-owned listings and order views, customer-owned order history, server-side checkout creation, stock reservation/release, and payment verification. Checkout requires a customer-scoped idempotency key. Seller account IDs and customer account IDs are resolved from the authenticated session; callers cannot supply ownership IDs.
- Checkout totals are calculated from published seller listings in integer kobo. Orders stay pending until a signed Paystack `charge.success` webhook or server-side transaction verification matches the order reference, amount and NGN currency.
- Raw card data is not collected or stored. The frontend’s current checkout remains an explicitly labeled preview until verified seller inventory is added and the API deployment is connected.
- Neon credentials, a public backend deployment, OAuth callback origin and Paystack test credentials/webhook URL have not been provided. No database migration was applied, and live commerce is not enabled.
- Pending checkouts reserve inventory until a verified success or failure arrives. Add a scheduled expiration/reconciliation flow for abandoned or delayed payments before launch; do not release stock solely on a timeout without reconciling Paystack first.

## Next after configuration

- Provision/configure Neon, apply the new `drizzle/postgres/` baseline, and migrate any MySQL data explicitly if it must be retained.
- Have the owner log in, configure the confirmed `OWNER_OPEN_ID`, and verify initial admin bootstrap in the deployed backend.
- Deploy the Express backend with the storefront or configure a separate API host; then test OAuth cookies, CORS, webhook signatures, transaction verification and stock release using Paystack test mode.
- Add pending-payment expiration/reconciliation and operational handling for late successful payments before opening checkout to customers.
- Connect the frontend catalog/checkout to published server catalog products and authenticated order/payment APIs. Add seller-facing listing-management UI and customer order detail/history screens before enabling customer-facing live checkout.
