# NaijaKoblas

NaijaKoblas is a React storefront with an Express/tRPC backend, OAuth accounts, role-scoped seller workspaces, and a Neon Postgres data layer.

## Local commands

- `pnpm install` installs the lockfile dependencies.
- `pnpm dev` starts the application server (default port 3000).
- `pnpm build` builds the storefront and server bundle; `pnpm start` runs the production server.
- `pnpm check` and `pnpm test` run TypeScript validation and unit tests.
- `pnpm db:generate` creates a Postgres migration from `drizzle/schema.ts`.
- `pnpm db:migrate` applies migrations from `drizzle/postgres/`.

## Neon configuration

Copy `.env.example` to `.env`. Set `DATABASE_URL` to Neon’s pooled PostgreSQL URL for the application runtime. Set `DATABASE_URL_UNPOOLED` to the direct Neon URL for migration commands. Both values are secrets. The checked-in `drizzle/0000_initial_users.sql` and `drizzle/0001_tense_shape.sql` are legacy MySQL history and must not be applied to Neon; the new Postgres baseline is isolated in `drizzle/postgres/`.

The Postgres migration is a fresh schema baseline. It does not copy existing managed-MySQL records. If account or seller data must be preserved, export, transform and validate it as a separate migration before switching production traffic.

## First administrator

Do not set `OWNER_OPEN_ID` until the project owner has completed the real OAuth login and the exact server-side OAuth identity is known. Once configured as a protected server secret, the first matching customer login can become the initial administrator only if no administrator or bootstrap record exists. That one-time promotion and its audit event are transactional. No public operation accepts an owner identity or grants administrator status.

## Hosted checkout

The server creates customer profiles, owner-scoped seller listings, pending orders, item snapshots and payment records. Prices, inventory reservations and delivery totals are resolved on the server in integer kobo. Checkout requests use a customer-scoped idempotency key. Paystack receives only the persisted order total and customer email. The browser is redirected to Paystack’s hosted checkout; card number, expiry and CVV fields are not collected by this application. A signed webhook and server-side transaction verification are required before an order becomes paid.

Set a Paystack test secret as `PAYSTACK_SECRET_KEY` and the public site origin as `APP_BASE_URL` only in the backend deployment environment. The current storefront checkout remains a preview until its catalog is populated with approved seller products and a backend deployment is connected. Pending checkouts reserve inventory; add scheduled expiry and reconcile the provider’s status before releasing stock for abandoned or delayed payments. Do not use live keys until test webhooks and payment reconciliation pass in the deployed environment.

## Deployment

The current GitHub/Vercel configuration is a static SPA with a catch-all rewrite to `index.html`. That deployment cannot serve the Express OAuth, tRPC or payment webhook routes. Keep live commerce disabled until the Express server and frontend are deployed together or a separate API host is configured with the correct API base URL, HTTPS origin, cookie/CORS policy, OAuth callback, and Paystack webhook URL.
