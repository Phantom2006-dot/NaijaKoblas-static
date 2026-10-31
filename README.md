# NaijaKoblas

NaijaKoblas is a Nigerian leather-goods multi-vendor marketplace. The stack is React/Vite, Express/tRPC, Neon PostgreSQL, Clerk email/password identity and Paystack-hosted checkout. Live payments, vendor splits and payouts remain disabled.

## Existing test deployment

- **Storefront:** [https://naijakoblas-static.vercel.app](https://naijakoblas-static.vercel.app)
- **Sign up:** [https://naijakoblas-static.vercel.app/signup](https://naijakoblas-static.vercel.app/signup)
- **Sign in:** [https://naijakoblas-static.vercel.app/login](https://naijakoblas-static.vercel.app/login)
- **Headless administrator entry (new workflow, not deployed yet):** [https://naijakoblas-static.vercel.app/admin](https://naijakoblas-static.vercel.app/admin)
- **API host:** [https://naijakoblas-static.fly.dev](https://naijakoblas-static.fly.dev)
- **Health:** `https://naijakoblas-static.vercel.app/api/health`
- **Paystack webhook path for future test setup:** `https://naijakoblas-static.vercel.app/api/payments/paystack/webhook`

Vercel serves the static Vite storefront and proxies `/api/*` to Fly before the SPA fallback. The production alias is public and preview deployments are protected. The previously deployed Clerk version has a matching server/browser publishable key; its sign-in/sign-up forms render. No registration, email verification or authenticated account flow was submitted during smoke testing.

The existing Fly app `naijakoblas-static` is in Amsterdam on one `shared-cpu-1x` 512 MB machine, port 3000, configured to autostart and stop when idle. Its machine was stopped after tests to reduce metered compute use; stopped storage and other provisioned resources may still incur charges. No duplicate machine or dedicated IPv4 is required. `DATABASE_URL`, `APP_BASE_URL`, and the Clerk key pair are stored as protected Fly secrets; values are not committed or printed. The obsolete `MANUS_JWT_SECRET` was removed. `OWNER_CLERK_USER_ID` is not set yet.

The empty London Free-plan Neon test project has the approved PostgreSQL baseline. The current worktree adds gallery and notification migrations `0001`/`0002` plus a Fly pre-release migration command; they have been exercised twice against an ephemeral local PostgreSQL instance, not applied to Neon. The live API/database contains no approved test seller or listing.

## Clerk accounts and role boundaries

Clerk is the only end-user identity provider. It handles password storage, verification and recovery; NaijaKoblas does not store password hashes. Every authenticated API request checks the current Clerk profile and requires a verified primary email before account synchronization or authorization. Application roles live in Neon and cannot be supplied by the browser or Clerk metadata.

The dedicated **NaijaKoblas** Clerk development app has email/password sign-up, required email verification by one-time code, Google sign-in disabled, a 15-character minimum password, compromised-password rejection, and email-code sign-in enabled. If you have not registered in this new app, use [Create account](https://naijakoblas-static.vercel.app/signup), verify the email, then use [Sign in](https://naijakoblas-static.vercel.app/login). Existing Manus OAuth sessions were not imported. Keep passwords and verification codes private.

The new `/admin` route is a separate entry outside the storefront shell and has no public-navigation link. It uses the same Clerk identity, then checks the Neon role; only `admin` can see administrator tools. Staff and sellers cannot gain administrator access by knowing the route. The first administrator is bootstrapped once for the exact configured `OWNER_CLERK_USER_ID`, only after verified sign-in and only if no administrator exists. The owner ID and bootstrap have not yet been configured/tested.

## Seller, staff and administrator workflow (current uncommitted code)

An approved seller keeps one Clerk account for shopping and store management. The signed-in navigation exposes a Seller Workspace or Staff Portal link for the corresponding database role; `/account` also links to the role workspace. The seller dashboard links back to customer account functions. Customer/staff/seller identity is not switched or impersonated; permissions remain database-authoritative.

Sellers create their own draft listings. Staff and administrators can select an approved seller with an active store and create a draft listing on that seller’s behalf. It remains seller-owned and unpublished; the seller must review it, add/select a primary product photo, and have available stock before publishing. Staff/admin cannot publish it on the seller’s behalf.

Product images use an authenticated multipart Express endpoint and durable Cloudinary storage—not the Fly filesystem. The server validates the verified Clerk account, database role, seller approval/store status, product ownership, JPEG/PNG/WebP MIME and file signatures. Each file is at most 8 MB, a batch contains at most four images/32 MB combined, and a listing can contain ten images total. Upload authorization occurs before multipart parsing and is rechecked in the database transaction. Only one upload batch per API process can be active; that slot stays held until parsing, Cloudinary/database work and any cleanup finish, even if the client disconnects. Requests are limited to 12 batches per account per 10-minute process-local window. Cloudinary cleanup on database failure is retried three times and logs a warning if compensation still fails; a durable orphan-asset reconciler is future operational work. Keyboard users receive visible focus indicators; the mobile menu traps Tab/Shift+Tab and closes with Escape/outside dismissal, and the mobile filter drawer provides a focus-contained, dismissible dialog.

**Cloudinary app credentials are not currently present in the selected Fly app.** Before photo uploads can work after deployment, add these protected Fly secrets: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. Do not paste credentials into chat, GitHub or frontend environment variables. Until configured, the upload route intentionally returns a setup response instead of saving files to temporary local disk.

A signed-in notification bell shows recipient-scoped in-app events for seller applications/reviews, verified payment, fulfillment, staff-created drafts/photos and staff access changes. Defined seller/role notification events are persisted in the same database transactions as their business state changes; notification event keys are idempotent and long keys use a digest. The bell polls every 45 seconds and supports marking one/all read. This is an **in-app inbox only**; email, SMS, push or background-channel delivery is not implemented.

## Database and deployment migrations

Use pooled `DATABASE_URL` for application queries and direct `DATABASE_URL_UNPOOLED` for schema migrations. Migrations live in `drizzle/postgres/`; historical root `drizzle/0000_initial_users.sql` and `drizzle/0001_tense_shape.sql` are legacy MySQL files and must not be applied to Neon. Fly’s `release_command` runs the compiled Drizzle migration runner before a new API release starts; it prefers `DATABASE_URL_UNPOOLED` and otherwise falls back to `DATABASE_URL`. The selected Fly app currently has no `DATABASE_URL_UNPOOLED`; add the direct URL through protected Secrets before rollout if available.

## Local development and checks

- `pnpm install` installs the lockfile dependencies.
- `pnpm dev` starts the Express/Vite application (default port 3000).
- `pnpm build` builds the storefront, server bundle and migration runner; `pnpm build:static` builds the Vercel frontend.
- `pnpm check` and `pnpm test` run TypeScript validation and the server/unit suite.
- `pnpm db:generate` creates a PostgreSQL migration from `drizzle/schema.ts`.
- `pnpm db:migrate` applies migrations from `drizzle/postgres/`.

Cloudinary credentials, the Clerk secret and Paystack secret are server-only. Optional Manus Maps/service values are unrelated to login. The static bundle must never contain a server credential.

## Paystack checkout and seller payouts

Paystack is not configured. Do not accept test or live charges until a test `PAYSTACK_SECRET_KEY` and webhook endpoint are added and verified. The server calculates totals in integer kobo, reserves stock transactionally, and requires provider-verified reference, amount and NGN currency before confirming orders. The browser redirects to Paystack-hosted checkout; NaijaKoblas never collects card number, expiry or CVV.

Payments currently settle to the marketplace account. Seller subaccounts, commission splits and vendor payouts are not implemented. Define commissions, seller bank verification, refunds/chargebacks, reconciliation and settlement rules before routing funds to vendors. See [backend research](backend-research.md) and the implementation checklist in [TODO.md](TODO.md).

## Validation and current blockers

The latest worktree passes TypeScript checks, 15 test files/69 tests, production and static builds, `git diff --check`, and an AMD64 production-image build (about 75 MB). All three migrations applied twice to an ephemeral local PostgreSQL instance and produced exactly three migration records plus the expected format constraint. Fly strict configuration validation passed. The compiled production server health/auth-status smoke test passed on the native host. Independent backend and frontend audits found no remaining medium/high issues; the upload-disconnect, primary-photo publication and keyboard-focus-return findings have been fixed and rechecked. **The new workflow code is not pushed or deployed:** the release migration has not been applied to Neon, Fly has no Cloudinary keys or direct migration URL, no approved test seller/listing exists, owner admin bootstrap has not been exercised, and Paystack remains unconfigured.
