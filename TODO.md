# NaijaKoblas TODO

## Implemented in code and test infrastructure

- Customer, seller, staff and administrator access is tied to the authenticated OAuth account. Seller approval and staff/admin actions are protected and audited. Initial administrator bootstrap still requires the owner’s exact server identity.
- A fresh Neon/Postgres schema and baseline migration cover accounts, profiles, seller applications/stores, seller listings, orders, item snapshots, Paystack transactions and per-line fulfillment. The approved baseline has been applied to the empty Neon Free-plan test project in London; no production data was changed or copied from the legacy MySQL history.
- The public catalog reads only published, in-stock listings from active seller stores. Seller listing operations are owner-scoped; stock edits are blocked while pending checkout reserves units.
- Customer checkout persists server-priced orders, stock reservations and canonical idempotency fingerprints. Paystack initialization uses a unique server-owned reference, NGN/kobo amounts and a hosted authorization URL. Signed webhook and customer verification paths match reference, amount, NGN currency and order data before marking an order paid.
- Customer account UI shows private order history and a trusted link to resume a pending hosted checkout. Seller UI supports draft listing creation, publication/archive, price/stock edits and seller-scoped per-item processing, shipping and delivery updates. Suspended sellers retain a fulfillment-only path for previously paid lines. Administrators can manually re-check pending Paystack references; paid/failed transitions are provider-verified and actor-audited.
- Fly/Vercel configuration is in the repository: a London one-machine 512 MB Fly target with health check and idle auto-stop, plus a static Vercel build and `/api/*` proxy. A manual GitHub Actions workflow builds a short-lived x86_64 Fly image artifact without deployment or database secrets.

## Blockers and pre-launch work

- The pooled Neon `DATABASE_URL` has been saved in Fly Secrets; its value was not read or committed. Fly app record `naijakoblas-api-test` exists, but no image or app machine is deployed. Depot builds timed out, the existing 8-vCPU legacy builder was stopped after it could not connect, and the sandbox-local build failed on its ARM/x86_64 mismatch. Run the new manual image workflow, push the resulting image to Fly and deploy before database-backed API tests. The Vercel project has not yet been created or deployed.
- Manus OAuth configuration and the Paystack test secret are still missing from Fly. The exact Vercel production origin must be set as `APP_BASE_URL` after the Vercel project is created; then verify the OAuth callback and Paystack webhook callbacks. Do not enable live customer transactions.
- Paystack merchant-dashboard availability must be confirmed for Nigerian card, transfer and USSD methods. Seller subaccounts and multi-split transactions are supported in Paystack’s docs but are not implemented here. Before routing money to vendors, define commission and fee rules, verify seller bank details and agree refund/chargeback/reconciliation procedures.
- Pending inventory releases only after verified provider failure/abandonment/reversal. Add a scheduled reconciliation job and operational escalation for transactions that remain pending or have ambiguous network outcomes before launch; do not free stock solely because a timer elapsed.
- Refund/return policy, support/dispute workflow, shipping/carrier integration, customer notifications, image storage/upload, seller commission ledger and automated payouts remain unimplemented.
- TypeScript, 43 unit tests, production build and static Vercel build pass. The API deployment/health check, Neon-backed query, Vercel deployment/proxy, OAuth and Paystack test transaction remain unverified.

## Next

1. Run `.github/workflows/build-fly-image.yml` manually on GitHub and download its one-day x86_64 image artifact. Use the existing Fly CLI credential locally to push the image and deploy exactly one London shared 512 MB API machine with auto-stop; do not put Fly or Neon secrets in GitHub Actions.
2. Verify the Fly API health route and a public database-backed catalog call against the already-migrated Neon test database. Check Fly logs for missing configuration without printing secret values.
3. Create/deploy the Vercel project from the connected repository. Confirm its `/api/*` rewrite reaches Fly and set the exact production `APP_BASE_URL` in Fly Secrets.
4. Add the Manus OAuth and Paystack test configuration through protected Fly secret input, then test OAuth, checkout initialization, signed webhooks, customer verification, idempotent retries and stock release only in test mode.
5. Agree seller settlement policy and bank-account verification before implementing Paystack subaccounts/multi-split. Add scheduled reconciliation, refunds/returns and operational support before launch.
