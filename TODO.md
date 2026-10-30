# NaijaKoblas TODO

## Built in code; still requires real-environment validation

- Customer, seller, staff and administrator access is tied to the authenticated OAuth account. Seller approval and staff/admin actions are protected and audited. Initial administrator bootstrap still requires the owner’s exact server identity.
- A fresh Neon/Postgres schema and baseline migration cover accounts, profiles, seller applications/stores, seller listings, orders, item snapshots, Paystack transactions and per-line fulfillment. The baseline applies cleanly to an ephemeral PostgreSQL-compatible engine; it has not been applied to a live database.
- The public catalog reads only published, in-stock listings from active seller stores. Seller listing operations are owner-scoped; stock edits are blocked while pending checkout reserves units.
- Customer checkout persists server-priced orders, stock reservations and canonical idempotency fingerprints. Paystack initialization uses a unique server-owned reference, NGN/kobo amounts and a hosted authorization URL. Signed webhook and customer verification paths match reference, amount, NGN currency and order data before marking an order paid.
- Customer account UI shows private order history and a trusted link to resume a pending hosted checkout. Seller UI supports draft listing creation, publication/archive, price/stock edits and seller-scoped per-item processing, shipping and delivery updates. Suspended sellers retain a fulfillment-only path for previously paid lines. Administrators can manually re-check pending Paystack references; paid/failed transitions are provider-verified and actor-audited.

## Blockers and pre-launch work

- No Neon connection credentials, Paystack test secret, public backend deployment or production OAuth callback have been supplied. The migration has not been applied and database-backed end-to-end tests have not run.
- Paystack merchant-dashboard availability must be confirmed for Nigerian card, transfer and USSD methods. Seller subaccounts and multi-split transactions are supported in Paystack’s docs but are not implemented here. Before routing money to vendors, define commission and fee rules, verify seller bank details and agree refund/chargeback/reconciliation procedures.
- Pending inventory releases only after verified provider failure/abandonment/reversal. Add a scheduled reconciliation job and operational escalation for transactions that remain pending or have ambiguous network outcomes before launch; do not free stock solely because a timer elapsed.
- Refund/return policy, support/dispute workflow, shipping/carrier integration, customer notifications, image storage/upload, seller commission ledger and automated payouts remain unimplemented.
- The current Vercel setup is static-only. Deploy the Express backend with the frontend or connect a separately hosted API and configure HTTPS, exact-origin CORS/cookies, OAuth callbacks and the Paystack webhook.

## Next

1. When database testing is needed, provide Neon’s pooled runtime URL and direct migration URL. Review the target database and legacy-data needs before applying the baseline.
2. Configure the owner’s confirmed OAuth identity, then test initial-admin bootstrap and role/ownership boundaries against the real database.
3. Provide a Paystack test secret after confirming the dashboard’s enabled payment channels. Deploy the public API/webhook endpoint and test checkout, callback verification, signed webhooks, idempotent retries and stock release in test mode.
4. Agree seller settlement policy and bank-account verification before implementing Paystack subaccounts/multi-split. Add scheduled reconciliation, refunds/returns and operational support before launch.
