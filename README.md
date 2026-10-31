# NaijaKoblas

NaijaKoblas is a Nigerian leather-goods marketplace with a React storefront, Express/tRPC API, Clerk email/password authentication, customer and seller accounts, seller-owned listings, inventory, per-line fulfillment, Neon Postgres persistence and Paystack-hosted checkout. This remains a test deployment; vendor payouts and production commerce are not enabled.

## Live test deployment

- **Storefront:** [https://naijakoblas-static.vercel.app](https://naijakoblas-static.vercel.app)
- **Sign up:** [https://naijakoblas-static.vercel.app/signup](https://naijakoblas-static.vercel.app/signup)
- **Sign in:** [https://naijakoblas-static.vercel.app/login](https://naijakoblas-static.vercel.app/login)
- **API host:** [https://naijakoblas-static.fly.dev](https://naijakoblas-static.fly.dev)
- **Health:** `https://naijakoblas-static.vercel.app/api/health`
- **Paystack webhook path for later test setup:** `https://naijakoblas-static.vercel.app/api/payments/paystack/webhook`

Vercel serves the static Vite storefront; its `/api/*` rewrite proxies to Fly before the SPA fallback, keeping the browser-facing frontend and API on one origin. The Vercel production alias is public and preview deployments are protected. The production bundle includes the Clerk public key. The API health and auth-readiness endpoints returned HTTP 200; readiness is configured and the backend publishable key matches the Vercel build. Both the Clerk sign-in and sign-up forms render.

Fly release v7 uses image `clerk-381db51` on one `shared-cpu-1x` 512 MB machine in Amsterdam, listening on port 3000. The machine was stopped after verification and is configured to auto-start on requests and stop when idle. A shared IPv4 is assigned; no paid dedicated IPv4 was allocated. Fly meters compute while the machine runs. Auto-stop reduces idle compute use, but stopped root-filesystem storage and other provisioned resources may still incur charges. See [Fly pricing](https://fly.io/pricing/) and the [Fly public-networking guide](https://docs.fly.io/networking/services/).

The Neon pooled `DATABASE_URL` is connected to the empty London Free-plan test project, where the approved Postgres baseline was applied. `APP_BASE_URL` is set to the production Vercel origin. No MySQL data was copied. Fly Secrets now contain `DATABASE_URL`, `APP_BASE_URL`, `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`; values are never committed or shown here. The obsolete `MANUS_JWT_SECRET` was removed. `OWNER_CLERK_USER_ID` is not yet set. The older unused Fly app `naijakoblas-api-test` still has an unused staged database secret; it has not been deleted.

## Clerk email/password sign-in

The application uses Clerk only for user authentication. Clerk’s hosted React components provide email/password sign-up, sign-in, email verification and password recovery. NaijaKoblas does **not** store passwords or password hashes. Every authenticated API request checks the current Clerk profile and requires a verified primary email before account access, profile synchronization or first-admin bootstrap. The server keeps customer/seller/staff/admin roles in Neon and ignores identity-provider role claims.

The dedicated **NaijaKoblas** Clerk development app has email and password sign-up enabled, requires an email address and email verification by one-time code, and has Google sign-in turned off. Passwords must be at least 15 characters; compromised-password rejection is enabled. Clerk’s separate email-code sign-in option also remains enabled.

No account was created during smoke testing, and no previous Manus OAuth sessions were imported. If you have not yet registered in this new Clerk app, use [Create account](/signup), enter your email and a password of at least 15 characters, then complete the email-code verification. Keep passwords and verification codes private. Once verified, use [Sign in](/login) with that email and password; password recovery is handled by Clerk.

`VITE_CLERK_PUBLISHABLE_KEY` is saved in Vercel Production and its public value is present in the static frontend bundle. The matching test `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are deployed to Fly. The browser checks an uncached, public `/api/auth/status` endpoint before mounting Clerk; it exposes no secret. The API validates the authorized party against the exact `APP_BASE_URL=https://naijakoblas-static.vercel.app`. Partial key pairs or an invalid production origin fail closed.

After the owner creates and verifies the first account, configure `OWNER_CLERK_USER_ID` with that exact Clerk `user_…` ID in Fly Secrets. The one-time bootstrap promotes only that configured account, only if no administrator exists, and records an audit event. Do not guess the ID or share password/verification details. The owner bootstrap has not yet been tested.

## Local development and database

- `pnpm install` installs the lockfile dependencies.
- `pnpm dev` starts the Express/Vite application (default port 3000).
- `pnpm build` builds the storefront and server bundle; `pnpm start` runs the production server.
- `pnpm check` and `pnpm test` run TypeScript validation and automated tests.
- `pnpm db:generate` creates a PostgreSQL migration from `drizzle/schema.ts`.
- `pnpm db:migrate` applies migrations from `drizzle/postgres/`.

Copy `.env.example` to `.env` for local work. Set `DATABASE_URL` to Neon’s pooled PostgreSQL URL for runtime queries and `DATABASE_URL_UNPOOLED` to the direct Neon URL for migrations. Keep both server-side. The checked-in `drizzle/0000_initial_users.sql` and `drizzle/0001_tense_shape.sql` are legacy MySQL history and must not be applied to Neon; the PostgreSQL baseline is isolated in `drizzle/postgres/`.

## Paystack checkout and seller money flow

Paystack remains unconfigured; do not accept test or live charges until a test `PAYSTACK_SECRET_KEY` and webhook endpoint are added. The server creates pending orders from live database listings, calculates totals in integer kobo, reserves stock and binds retry keys to canonical checkout payloads. The browser is redirected to Paystack-hosted checkout; NaijaKoblas never collects card number, expiry or CVV. Signed webhooks and server-side transaction verification require stored reference, amount and NGN currency to match before an order becomes paid.

A protected admin queue can manually verify pending payments; scheduled reconciliation for abandoned or ambiguous transactions remains future work. Paystack documents Nigerian card, transfer and USSD channels subject to merchant enablement. Seller subaccounts and multi-split transactions are not implemented: payments currently settle to the marketplace account. Define commission, fees, bank verification, refunds/chargebacks and reconciliation policy before routing funds to vendors. See [backend research and official sources](backend-research.md).

The buyer storefront uses the server catalog and hosted checkout; customer accounts show order history and resumable pending payment links. Seller tools cover listings, stock and per-item fulfillment. Suspended sellers retain a limited path to complete already-paid order lines. Refund/return workflows, notification delivery, image storage, shipping-carrier integration, seller commission accounting and automated payouts remain future work.
