# NaijaKoblas backend research

**Author:** Manus AI
**Research checked:** 30 October 2026

## Identity and account authorization

Use one OAuth-backed application account per person. The authenticated database role governs customer, seller, staff and administrator capabilities. A customer may submit a seller application; approval grants seller access, suspension removes it, and only protected staff/admin procedures can review applications or change staff access. Seller- and customer-owned records must be queried through the authenticated account ID, not a caller-supplied owner ID. These choices follow OWASP guidance to deny by default and check authorization at every request [12].

The first administrator is bootstrapped only after the project owner has completed OAuth and the exact server-returned identity is known. `OWNER_OPEN_ID` must not be guessed or exposed to a public operation. The one-time server guard requires an exact configured identity, customer role, no existing administrator and no bootstrap marker, then records an audit event. The HttpOnly session cookie stays Secure and cross-site on HTTPS preview/production, while local HTTP development uses a same-site policy [13].

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

Customer profiles, orders and payment status are private to the authenticated customer. Seller listings and order lines carry immutable seller ownership; the server resolves owner IDs from the authenticated session. Order totals are computed from published server catalog rows in integer kobo, and inventory reservations are made transactionally. Seller order queries reveal only the delivery contact/address fields needed for fulfilment, not customer email or payment data. Per-line seller fulfillment advances through processing, shipped and fulfilled states; overall order fulfillment is derived across sellers. Stock editing is serialized against checkout and blocked while a pending payment reserves that listing.

Paystack documents `abandoned` and `failed` as unsuccessful, and `reversed` as a refunded or successfully disputed/charged-back transaction [20]. For an order still in `pending_payment` (not yet fulfilled), these statuses release the reserved inventory once; a `reversed` transaction is never treated as a new success. `pending`, `ongoing` and `processing` remain reserved. Success is accepted only after signed-webhook or server-verification checks. Ambiguous initialization/network outcomes remain pending; scheduled reconciliation and escalation are still needed before launch, and stock must not be freed solely because a timer elapsed. Refunds, returns, support/dispute workflow, seller commissions and vendor payouts remain unimplemented.

## Fly.io test hosting

The selected test app `naijakoblas-static` is in Amsterdam and is configured for one `shared-cpu-1x` 512 MB machine with HTTPS, a `/api/health` check, automatic start on requests and stop-on-idle. Its first GitHub launch generated `internal_port = 8080`, while the Node process listens on `0.0.0.0:3000`; Fly reported a refused connection, so that machine was stopped. The launch also reported a public IPv6 allocation error. The repository’s manifest now sets port 3000; the corrected deploy and public IP still need verification. Fly meters running-machine time; check any current stopped-machine storage/network charges in [Fly pricing](https://fly.io/pricing/) and [resource pricing](https://docs.fly.io/about/pricing). Configuration behavior is documented in Fly’s [configuration reference](https://docs.fly.io/reference/configuration).

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
