# NaijaKoblas backend research

**Author:** Manus AI
**Research checked:** 30–31 October 2026

## User authentication and application authorization

The user selected Clerk only, replacing Manus OAuth, for ordinary email/password account authentication. Use Clerk’s React SDK (`@clerk/react`) sign-in/sign-up components and its configured email verification and password recovery flows [24]–[28]. NaijaKoblas does not collect or store user passwords or password hashes; Clerk manages credential storage, password verification and account recovery. This avoids creating a custom password-storage/reset system and follows OWASP’s guidance on password storage, authentication and reset-token handling [34]–[36]. The API independently fetches the current Clerk profile on every authenticated request and rejects the request unless the primary email is verified; it does not create or sync an account and cannot bootstrap the configured owner while that check fails.

The browser obtains a Clerk session token through `useAuth().getToken()` and sends it to tRPC in the `Authorization: Bearer` header [29] [30]. The Express backend mounts Clerk middleware before API handling, verifies requests through `getAuth`, and fetches the authoritative Clerk profile through `clerkClient.users.getUser` [31]–[33]. Before installing middleware it requires both server keys and a valid exact public origin; production origins must use HTTPS, and `authorizedParties` is always the one-element `APP_BASE_URL` origin. Partial server key pairs or enabled Clerk without that origin fail startup rather than skipping audience validation. The browser checks a no-store auth-status endpoint and mounts Clerk only if its Vite publishable key matches the configured server public key. The endpoint returns no secret. The public Vite bundle receives only `VITE_CLERK_PUBLISHABLE_KEY`; `CLERK_SECRET_KEY` remains server-only.

The database’s existing unique `openId` column stores the Clerk user ID for compatibility with the fresh test schema; no password field was added. Customer/seller/staff/admin roles remain separate Neon data and cannot be set by Clerk profile claims or caller input. Seller applications are reviewed before seller access; role changes and admin reconciliation actions remain protected/audited. These application authorization choices follow OWASP’s deny-by-default and per-request ownership guidance [12].

The first administrator is bootstrapped only for the exact configured `OWNER_CLERK_USER_ID` after that user signs in, only while the identity has the customer role, and only if no administrator or bootstrap marker exists. The transaction writes an audit event. Never guess this ID or expose an unauthenticated promotion route. The test database is empty; no old Manus OAuth users are being mapped or imported. A production identity-linking plan would be required before replacing any existing live user identities.

## Neon and Drizzle

Neon recommends a pooled connection URL for application traffic and a direct connection URL for schema migrations, because pooled connections can cause migration issues [1]. Drizzle’s PostgreSQL guide documents its `node-postgres` adapter and pool-based connection [2].

The application uses Drizzle with `pg.Pool`; runtime reads pooled `DATABASE_URL`, while Drizzle Kit prefers `DATABASE_URL_UNPOOLED`. The `drizzle/postgres/` baseline is a fresh schema, not a copy of existing MySQL data. Historical MySQL migrations remain legacy and must not be applied to Neon. Any data preservation requires a separately tested export/transform/import before production traffic changes.

## Nigerian buyer payments: Paystack selected

Paystack’s redirect flow is appropriate for this Nigeria-first storefront: its server initializes a transaction with the merchant secret, amount in the currency subunit, customer email, unique reference and callback URL, then redirects the buyer to the returned hosted Checkout URL. Paystack explicitly says not to expose the secret key in the frontend and to verify both successful status and amount before delivering value [14] [15]. This app stores NGN in integer kobo, calculates prices and stock on the server, and accepts only `https://checkout.paystack.com` for the hosted redirect.

Paystack documents cards across its markets, bank transfer for Nigerian and Ghanaian businesses, and USSD for Nigerian customers; channel availability is still controlled by the merchant’s country/account and Paystack Dashboard. The app requests `card`, `bank_transfer` and `ussd`, but the actual test merchant must confirm which are enabled before any public launch [17]. The callback URL is not proof of payment: the app calls the server-side transaction-verification API, while the webhook checks Paystack’s HMAC-SHA512 `x-paystack-signature` over the exact raw request body. Both paths require the stored transaction reference, amount and NGN currency to match before an order becomes paid [15] [16].

## Vendor settlement and marketplace limits

Paystack supports seller subaccounts and split settlements. Its multi-split guide describes splitting one transaction across the main account and one or more subaccounts, with dynamic flat/percentage shares; the split flow depends on seller subaccounts [18] [19]. Paystack’s subaccount guidance tells merchants to verify bank-account details carefully because it will not be liable for a payout sent to the wrong account [19].

The current implementation initializes customer payments to the marketplace merchant account only. It does **not** create subaccounts, dynamically split vendor shares, calculate commissions or execute transfers. Do not claim that sellers are paid automatically. Before enabling splits, the business must define commission and fee-bearer rules, seller identity/bank verification, refund/chargeback handling, settlement timing and reconciliation. Confirm these arrangements and all channel/subaccount features in the actual Paystack Dashboard and test environment; official API availability alone does not establish that this merchant is approved for every feature.

## Why Stripe is not the selected first gateway

Stripe’s published global availability list does not list Nigeria as a country where a business can directly open a standard Stripe payments account [3]. Stripe separately documents Nigerian local Naira card and bank-transfer methods through eligible foreign account locations; its Nigeria overview and individual Checkout guides specify US accounts for those Naira methods [4] [5] [6]. Stripe’s support article describes the legal entity, tax, physical presence, identity and bank requirements for opening an account in another country [9]. Do not route around country eligibility with a borrowed or nominal account.

Stripe Connect documents country-specific connected-account/payout configurations, but that does not independently establish a supported Nigerian marketplace payout route for this business [10] [11]. Since Paystack documents Nigeria-focused checkout channels and multi-split settlement, it is the better starting point for NaijaKoblas. Stripe is retained here only as a comparison, not as an active provider integration.

## Marketplace records and operational boundaries

Customer profiles, orders and payment status are private to the authenticated customer. Seller listings and order lines carry immutable seller ownership; the server resolves owner IDs from the verified Clerk-to-Neon account mapping. Order totals are computed from published server catalog rows in integer kobo, and inventory reservations are made transactionally. Seller order queries reveal only the delivery contact/address fields needed for fulfilment, not customer email or payment data. Per-line seller fulfillment advances through processing, shipped and fulfilled states; overall order fulfillment is derived across sellers. Stock editing is serialized against checkout and blocked while a pending payment reserves that listing.

Paystack documents `abandoned` and `failed` as unsuccessful, and `reversed` as a refunded or successfully disputed/charged-back transaction [20]. For an order still in `pending_payment` (not yet fulfilled), these statuses release the reserved inventory once; a `reversed` transaction is never treated as a new success. `pending`, `ongoing` and `processing` remain reserved. Success is accepted only after signed-webhook or server-verification checks. Ambiguous initialization/network outcomes remain pending; scheduled reconciliation and escalation are still needed before launch, and stock must not be freed solely because a timer elapsed. Refunds, returns, support/dispute workflow, seller commissions and vendor payouts remain unimplemented.

## Fly.io and Vercel test hosting

The selected test app `naijakoblas-static` is in Amsterdam with one `shared-cpu-1x` 512 MB machine. The application listens on `0.0.0.0:3000`; `fly.toml` uses that internal port, enables HTTPS, checks `/api/health`, and configures autostart plus stop-on-idle. A free shared IPv4 was assigned using `fly ips allocate-v4 --shared` after the first launch reported an IP allocation error. Fly pricing bills compute by the second while running, includes shared IPv4 at no IP charge and may bill stopped storage or other provisioned resources separately [21].

The Vercel Hobby project `naijakoblas-static` is linked to `Phantom2006-dot/NaijaKoblas-static` at `https://naijakoblas-static.vercel.app`. Its Vite production build uses Node 22; preview deployments are protected and the production alias is public. The committed `vercel.json` sends `/api/*` to Fly before the SPA fallback. Fly’s `APP_BASE_URL` is set to the production Vercel origin. Live checks returned HTTP 200 for the storefront, `/api/health`, anonymous `auth.me` and the Neon-backed catalog; the catalog is empty. The Fly machine auto-starts on requests and stops when idle.

The Clerk code is implemented and local TypeScript, tests and builds pass, but Clerk is not yet configured on either host. Set `VITE_CLERK_PUBLISHABLE_KEY` in Vercel and the same publishable key as `CLERK_PUBLISHABLE_KEY` plus server-only `CLERK_SECRET_KEY` in Fly. Email/password, email verification, password recovery, account sync and authorization must be verified against that Clerk test instance. `OWNER_CLERK_USER_ID` remains unset until the owner account exists. Paystack’s test key is also absent; hosted payment and webhook callbacks remain untested. Optional Manus API values are unrelated to login and are used only by remaining platform service/map integrations.

## References

[1]: https://neon.tech/docs/guides/drizzle "Connect from Drizzle to Neon"
[2]: https://orm.drizzle.team/docs/get-started-postgresql "Drizzle ORM PostgreSQL guide"
[3]: https://stripe.com/global "Stripe global availability"
[4]: https://docs.stripe.com/payments/countries/nigeria "Stripe Nigerian payment methods"
[5]: https://docs.stripe.com/payments/ng-card/accept-a-payment.md?payment-ui=checkout "Stripe Naira card Checkout"
[6]: https://docs.stripe.com/payments/ng-bank-transfer/accept-a-payment.md?payment-ui=checkout "Stripe Naira bank transfer Checkout"
[9]: https://support.stripe.com/questions/requirements-to-open-a-stripe-account-in-another-country "Stripe account requirements in another country"
[10]: https://docs.stripe.com/connect/accounts "Stripe Connect connected accounts"
[11]: https://docs.stripe.com/connect/connect-cross-border-payouts "Stripe Connect cross-border payouts"
[12]: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html "OWASP Authorization Cheat Sheet"
[13]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html "OWASP Session Management Cheat Sheet"
[14]: https://paystack.com/docs/payments/accept-payments/ "Paystack hosted redirect checkout"
[15]: https://paystack.com/docs/api/transaction/ "Paystack transaction initialize and verify APIs"
[16]: https://paystack.com/docs/payments/webhooks/ "Paystack webhook signatures and events"
[17]: https://paystack.com/docs/payments/payment-channels/ "Paystack payment-channel availability"
[18]: https://paystack.com/docs/payments/multi-split-payments/ "Paystack multi-split payments"
[19]: https://paystack.com/docs/payments/split-payments/ "Paystack subaccounts and split payments"
[20]: https://paystack.com/docs/payments/verify-payments/ "Paystack transaction status definitions"
[21]: https://fly.io/pricing/ "Fly Machines and network pricing"
[22]: https://docs.fly.io/networking/services/ "Fly public network services and IPs"
[23]: https://docs.fly.io/networking/app-services/ "Fly app services and public routing"
[24]: https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options "Clerk email/password strategies and verification settings"
[25]: https://clerk.com/docs/react/getting-started/quickstart "Clerk React quickstart"
[26]: https://clerk.com/docs/react/reference/components/authentication/sign-in "Clerk React SignIn"
[27]: https://clerk.com/docs/react/reference/components/authentication/sign-up "Clerk React SignUp"
[28]: https://clerk.com/docs/guides/development/clerk-environment-variables "Clerk environment variables"
[29]: https://clerk.com/docs/guides/development/making-requests "Clerk authenticated requests"
[30]: https://clerk.com/docs/react/reference/hooks/use-auth "Clerk useAuth hook"
[31]: https://clerk.com/docs/expressjs/getting-started/quickstart "Clerk Express quickstart"
[32]: https://clerk.com/docs/reference/express/overview "Clerk Express SDK overview"
[33]: https://clerk.com/docs/reference/express/clerk-middleware "Clerk Express middleware"
[34]: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html "OWASP Password Storage Cheat Sheet"
[35]: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html "OWASP Authentication Cheat Sheet"
[36]: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html "OWASP Forgot Password Cheat Sheet"
