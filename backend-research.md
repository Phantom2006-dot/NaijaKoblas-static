# NaijaKoblas backend research

**Author:** Manus AI

**Research checked:** 30 October 2026

## Account and seller authorization

NaijaKoblas should use one OAuth-backed application account per person. The authenticated database role governs customer, seller, staff and administrator capabilities. A customer may submit one seller application; approval grants seller access, suspension removes it, and only protected staff/admin procedures can review applications or change staff access. Seller- and customer-owned records must be queried through the authenticated account ID, not a caller-supplied owner ID. These choices follow OWASP guidance to deny by default and check authorization at every request [6]. The existing HttpOnly, Secure, `SameSite=None` session cookie remains appropriate for the app’s cross-site HTTPS preview context; passwords and browser-selected roles are not introduced [7].

The first administrator is bootstrapped only after the project owner has completed OAuth and the exact server-returned identity is known. `OWNER_OPEN_ID` is not configured in this task. The new one-time server guard requires an exact configured identity, a customer role, no existing administrator and no bootstrap marker, then records an audit event. No public route grants administrator access.

## Neon and Drizzle

Neon supports Drizzle through PostgreSQL drivers, including `node-postgres`, Neon’s serverless drivers and `postgres.js`. Neon recommends a pooled connection string for application runtime and a direct connection string for schema migrations, because pooled connections can cause migration issues [1]. Drizzle’s PostgreSQL guide documents the `node-postgres` adapter and a `Pool`-based connection [2].

This application uses Drizzle’s `node-postgres` adapter with `pg.Pool`; runtime reads `DATABASE_URL`, while Drizzle Kit prefers `DATABASE_URL_UNPOOLED`. The new `drizzle/postgres/` baseline contains the account and commerce schema. The previous MySQL migrations are retained as legacy history and are not compatible with Neon. This is a clean new database baseline; it does not automatically copy existing managed-MySQL data.

## Hosted payment flow

Paystack’s transaction API requires backend initialization with a secret key and amount in the currency’s minor denomination. It returns a hosted `authorization_url`, and its verify endpoint returns transaction status, reference, amount and currency [3]. Paystack instructs merchants not to expose the secret key in the frontend and to verify both success status and amount before delivering value [4].

Paystack webhooks carry an `x-paystack-signature` HMAC-SHA512 signature calculated from the raw payload. The server verifies that signature before processing the event; Paystack also recommends webhooks over relying solely on the customer’s redirect [5]. The implementation therefore keeps order status pending until the signed webhook or a server-side transaction verification confirms the matching reference, amount and NGN currency. Card number, expiry and CVV are not collected or stored.

Paystack is a researched candidate that fits the storefront’s NGN and Card/Bank Transfer/USSD choices. It cannot be exercised until a Paystack test key, callback origin, public API deployment and webhook URL are configured. The current checkout remains a preview and must not be described as payment-complete.

## Commerce and seller ownership

The Neon schema includes one customer profile per account, seller stores, seller-owned products, pending orders, immutable order-item snapshots and payment transactions. Order creation accepts product IDs, quantities, sizes and delivery details. The server re-reads published listings, checks active seller ownership and inventory, reserves stock transactionally, calculates shipping and totals in integer kobo, and stores order/payment snapshots. On a failed payment, stock is released exactly once; on a verified success, the payment and order status change together.

A seller’s product and order queries filter by the session-resolved seller account ID. Order lines retain their seller owner key and display-name snapshot so later seller dashboards can show only the seller’s own items. Product records default to draft and cannot be purchased until an approved seller publishes them with stock.

## Deployment constraint

The current repository’s Vercel configuration rewrites every route to the static `index.html`, so it cannot serve Express OAuth callbacks, tRPC procedures or payment webhooks. The account and commerce backend must be deployed with its server runtime or on a separate API origin before checkout can be activated. The website’s API base URL, cookie/CORS policy, OAuth callback and Paystack webhook destination must agree with that deployment.

## References

[1]: https://neon.tech/docs/guides/drizzle "Connect from Drizzle to Neon"
[2]: https://orm.drizzle.team/docs/get-started-postgresql "Drizzle ORM PostgreSQL guide"
[3]: https://paystack.com/docs/api/transaction/ "Paystack transaction API"
[4]: https://paystack.com/docs/payments/accept-payments/ "Paystack accept payments"
[5]: https://paystack.com/docs/payments/webhooks/ "Paystack webhooks"
[6]: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html "OWASP Authorization Cheat Sheet"
[7]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html "OWASP Session Management Cheat Sheet"
