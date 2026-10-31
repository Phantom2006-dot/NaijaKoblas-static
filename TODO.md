# NaijaKoblas TODO

## Built in code and test infrastructure

- Customer, seller, staff and administrator access is tied to the authenticated OAuth account. Seller approval and staff/admin actions are protected and audited. Initial administrator bootstrap still requires the owner’s exact server identity.
- A fresh Neon/Postgres schema and baseline migration cover accounts, profiles, seller applications/stores, seller listings, orders, item snapshots, Paystack transactions and per-line fulfillment. The approved baseline has been applied to the empty Neon Free-plan test project in London; no production data was changed or copied from legacy MySQL.
- The public catalog reads only published, in-stock listings from active seller stores. Seller listing operations are owner-scoped; stock edits are blocked while pending checkout reserves units.
- Customer checkout persists server-priced orders, stock reservations and canonical idempotency fingerprints. Paystack checkout, signed webhooks and customer verification validate the stored reference, amount, NGN currency and order data.
- Customer order history and payment recovery, seller listing/inventory tools, per-item fulfillment, suspended-seller fulfillment-only access and an actor-audited admin payment-reconciliation queue are implemented.

## Fly/Vercel test deployment status

- The Fly GitHub launch created the selected app `naijakoblas-static` in Amsterdam and built its container image. Its first deployment failed because Fly’s generated service config expected port 8080 while the Node server listens on port 3000. The one 512 MB machine was stopped; the app was not deleted.
- `fly.toml` now targets `naijakoblas-static` in `ams` and declares the correct internal port 3000, health route and stop-on-idle behavior. The Vercel `/api/*` rewrite now targets `https://naijakoblas-static.fly.dev`. These local updates still need to be deployed.
- Fly also reported a public IPv6 allocation error during the first deploy. Confirm IP allocation and external health after the corrected deployment.
- The Neon `DATABASE_URL` remains staged on the old app `naijakoblas-api-test`; Fly will not reveal a stored secret for copying. Enter it directly into Secrets for `naijakoblas-static` using the value from Neon. The new app currently has no secrets. Remove the old app’s unused copy only after the new app’s database connection is verified.
- The GitHub Actions workflow successfully built an x86_64 artifact without secrets. GitHub’s current integration cannot manage Actions secrets, so no temporary Fly token was created and none was stored in GitHub.

## Blockers and pre-launch work

- Redeploy the existing image with the corrected port, exactly one test machine, and stop-on-idle. Verify `/api/health` and the database-backed catalog. Resolve the first-deploy public IP error if it recurs.
- Configure Manus OAuth values and Paystack test credentials in Fly only after the database-backed API is healthy. Create/deploy the Vercel project, verify its same-origin API proxy, then set the exact Vercel origin as `APP_BASE_URL` and verify OAuth/webhook callbacks.
- Paystack merchant-dashboard availability must be confirmed for Nigerian card, transfer and USSD methods. Seller subaccounts and multi-split transactions are documented but not implemented. Define commission and fee rules, verify seller bank details, and agree refund/chargeback/reconciliation procedures before routing money to vendors.
- Pending inventory releases only after provider-verified failure, abandonment or reversal. Add scheduled reconciliation and operational escalation for ambiguous transactions before launch.
- Refund/return policy, support/dispute workflow, shipping-carrier integration, customer notifications, image storage/upload, seller commission ledger and automated payouts remain unimplemented.
- TypeScript, 43 unit tests, production build and static Vercel build pass. Fly health, Neon-backed API behavior, Vercel deployment, OAuth and Paystack test transactions remain unverified.

## Next

1. Add `DATABASE_URL` directly to Fly Secrets for `naijakoblas-static`; do not paste it into chat. Keep the old staged value until the new app is confirmed connected.
2. Deploy the corrected `fly.toml` using the existing Fly-built image, with one Amsterdam 512 MB machine and auto-stop. Confirm the port-3000 health check passes and address IPv6 allocation if Fly still reports it.
3. Test a database-backed public catalog call, then remove the old app’s unused Neon secret. Keep the test machine stopped/idle when not testing.
4. Create/deploy Vercel from the connected repository. Verify `/api/*` reaches the new Fly app and set `APP_BASE_URL` to the exact production Vercel origin.
5. Add Manus OAuth and Paystack test secrets through protected Fly input and exercise OAuth, checkout, webhooks, payment verification, retries and stock release in test mode.
6. Agree seller settlement policy and bank verification before implementing Paystack subaccounts/multi-split; add scheduled reconciliation, refunds/returns and operational support before launch.
