# NaijaKoblas

NaijaKoblas is a Nigerian leather-goods multi-vendor marketplace. The stack is React/Vite, Express/tRPC, Neon PostgreSQL, Clerk email/password identity and Paystack-hosted checkout. Live payments, vendor splits and payouts remain disabled.

## Test deployment status

- **Storefront:** [https://naijakoblas-static.vercel.app](https://naijakoblas-static.vercel.app)
- **Sign up:** [https://naijakoblas-static.vercel.app/signup](https://naijakoblas-static.vercel.app/signup)
- **Sign in:** [https://naijakoblas-static.vercel.app/login](https://naijakoblas-static.vercel.app/login)
- **Administrator portal (role-protected):** [https://naijakoblas-static.vercel.app/admin](https://naijakoblas-static.vercel.app/admin)
- **API host:** [https://naijakoblas-static.fly.dev](https://naijakoblas-static.fly.dev)
- **Health:** `https://naijakoblas-static.vercel.app/api/health`
- **Paystack webhook path for future test setup:** `https://naijakoblas-static.vercel.app/api/payments/paystack/webhook`

Feature commit `70eec80` is included in READY Vercel production. Fly release v11 serves image `ops-70eec80`; its release command and migration pre-release completed successfully. Direct Fly and Vercel-proxied `/api/health` and `/api/auth/status` returned HTTP 200. The production `/`, `/login`, `/signup`, `/admin`, `/admin/catalog`, `/admin/audit`, `/vendor`, and `/account` routes returned HTTP 200, and the deployed bundle contains role-aware navigation, the admin Catalog/Audit workspace, one-click seller activation and standard admin-login flows.

The selected Fly app `naijakoblas-static` uses one `shared-cpu-1x` 512 MB machine in Amsterdam, port 3000, with autostart and stop-on-idle. The existing machine (`8dd629ce940968`) is stopped after smoke tests to minimize runtime; requests can autostart it. No duplicate machine or dedicated IPv4 was created. `DATABASE_URL`, `APP_BASE_URL`, the Clerk key pair, Cloudinary credentials and the protected `OWNER_CLERK_USER_ID` are Fly secrets; values are not committed or printed. `DATABASE_URL_UNPOOLED` is not configured. The obsolete `MANUS_JWT_SECRET` was removed.

## Clerk accounts and role boundaries

Clerk is the only end-user identity provider. It handles password storage, verification and recovery; NaijaKoblas does not store password hashes. Every authenticated API request checks the current Clerk profile and requires a verified primary email before account synchronization or authorization. Application roles live in Neon and cannot be supplied by the browser or Clerk metadata.

The dedicated **NaijaKoblas** Clerk development app has email/password sign-up, required email verification by one-time code, Google sign-in disabled, a 15-character minimum password, compromised-password rejection, and email-code sign-in enabled. If you have not registered in this new app, use [Create account](https://naijakoblas-static.vercel.app/signup), verify the email, then use [Sign in](https://naijakoblas-static.vercel.app/login). Existing Manus OAuth sessions were not imported. Keep passwords and verification codes private.

The `/admin` route is role-protected and uses the same branded `/login` flow as every other account. The standard login page links to `/login?returnTo=%2Fadmin`, and anonymous visits to `/admin` are directed back to that page. Only the Neon `admin` role can see administrator tools; staff and sellers cannot gain access by knowing the route. Initial admin bootstrap is limited to the exact configured `OWNER_CLERK_USER_ID` after verified sign-in and only when no administrator exists. The owner bootstrap ID is configured as a protected Fly secret. No account/password was created for this task; passwords and verification codes remain private.

## Seller, staff and administrator workflow

A verified ordinary customer can click **Become a seller** from `/account` or `/vendor` to activate seller access immediately, without entering seller-specific personal/business details or waiting for staff approval. Activation creates the seller role, an approved compatibility record and an active store in one database transaction, with audit and in-app notification records. Store name, city and description can be completed later. The same Clerk identity remains available for shopping and selling; database roles remain authoritative. Staff/admin roles are never replaced. Rejected, suspended, inactive-store and incomplete seller records remain blocked from self-reactivation; staff can still moderate legacy applications and suspend seller access.

Sellers create their own draft listings. Staff and administrators can select an active seller with an active store and create a draft listing on that seller’s behalf. It remains seller-owned and unpublished; the seller must review it, add/select a primary product photo, and have available stock before publishing. Staff/admin cannot publish it on the seller’s behalf.

Product images use an authenticated multipart Express endpoint and durable Cloudinary storage—not the Fly filesystem. The server validates the verified Clerk account, database role, active seller role/application/store status, product ownership, JPEG/PNG/WebP MIME and file signatures. Each file is at most 8 MB, a batch contains at most four images/32 MB combined, and a listing can contain ten images total. Upload authorization occurs before multipart parsing and is rechecked in the database transaction. Only one upload batch per API process can be active; that slot stays held until parsing, Cloudinary/database work and any cleanup finish, even if the client disconnects. Requests are limited to 12 batches per account per 10-minute process-local window. Cloudinary cleanup on database failure is retried three times and logs a warning if compensation still fails; a durable orphan-asset reconciler is future operational work. Keyboard users receive visible focus indicators; the mobile menu traps Tab/Shift+Tab and closes with Escape/outside dismissal, and the mobile filter drawer provides a focus-contained, dismissible dialog.

**Cloudinary app credentials are not currently present in Fly.** Before photo uploads can work, add these protected Fly secrets: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. Until configured, an authenticated upload attempt intentionally receives a storage-setup response; unauthenticated requests are rejected with HTTP 401 before parsing.

A signed-in notification bell shows recipient-scoped in-app events for direct seller activation, legacy application reviews/moderation, verified payment, fulfillment, staff-created drafts/photos and staff access changes. Defined seller/role notification events are persisted in the same database transactions as their business state changes; notification event keys are idempotent and long keys use a digest. The bell polls every 45 seconds and supports marking one/all read. This is an **in-app inbox only**; email, SMS, push or background-channel delivery is not implemented.

## Database migrations and safe recovery

Use pooled `DATABASE_URL` for application queries and direct `DATABASE_URL_UNPOOLED` for schema migrations where available. Migrations live in `drizzle/postgres/`; historical root `drizzle/0000_initial_users.sql` and `drizzle/0001_tense_shape.sql` are legacy MySQL files and must not be applied to Neon. Fly’s release command runs the compiled migration runner before a new API release starts. Both `pnpm db:migrate` and `pnpm db:push` route through this same custom runner; they do not call `drizzle-kit migrate` directly.

The Neon test database already contained the approved initial PostgreSQL baseline, but that baseline was applied before its Drizzle migration-ledger entry existed. Fly release v8 safely aborted on the existing `account_role` enum; its baseline transaction rolled back, so the gallery/notification migrations did not apply in that attempt. Drizzle creates its bookkeeping schema/table before its transaction, so that failed attempt may have left only an empty `drizzle.__drizzle_migrations` table. The new Fly v11 release completed the recovery runner and pending migrations successfully.

The runner sets a transaction-local `public` search path and checks the full baseline—not just names. Inside a transaction it recreates the initial DDL in a scratch schema and compares enum labels, baseline table columns/types/defaults, constraints/FKs, indexes and owned sequences/columns to the existing public schema. It validates that ledger entries are an exact ordered prefix of the current journal, serializes runners with a PostgreSQL transaction advisory lock, and applies pending migrations exactly once in the same transaction. Before replay, it refuses when pending migration objects or existing-table data targets are already present without corresponding ledger rows. The parser allows only reviewed quoted SQL forms, recognizes semicolons only outside quoted values/identifiers/dollar strings, and rejects multiple top-level commands, SQL comments, `USING INDEX`, unsupported grammar and unknown operations until an explicit parser rule and test are added. Partial/mismatched schema and conflicting/gapped history fail closed; scratch-schema cleanup runs in `finally` within the transaction.

A checked-in local-only integration command covers fresh setup with an unsafe ambient `search_path`, exact pre-applied baseline with user-data preservation, enum/schema mismatch, sequence-owner mismatch, unledgered later schema, the constraint-only migration, a data-only target against an existing table, history-gap refusal, and concurrent runners. It accepts only localhost and drops only its own randomly named temporary databases; it never reads the Fly/Neon `DATABASE_URL`. The integration suite and the regular `pnpm db:migrate` command (run twice on a disposable local database) passed; successful paths end with exactly three ledger rows. Fly's successful v9 release confirms the migrations also completed remotely, and the Vercel-proxied catalog query returns HTTP 200 against the now-migrated schema.

## Local development and checks

- `pnpm install` installs the lockfile dependencies.
- `pnpm dev` starts the Express/Vite application (default port 3000).
- `pnpm build` builds the storefront, server bundle and migration runner; `pnpm build:static` builds the Vercel frontend.
- `pnpm check` and `pnpm test` run TypeScript validation and the server/unit suite.
- `pnpm db:generate` creates a PostgreSQL migration from `drizzle/schema.ts`; review generated SQL before applying it.
- `pnpm db:migrate` compiles and runs the audited custom PostgreSQL migration runner.
- `pnpm db:push` generates reviewed Drizzle SQL, then invokes `pnpm db:migrate`; it does not bypass the custom runner.
- `pnpm test:migrations:integration` runs the real compiled runner against a **disposable localhost PostgreSQL** maintenance URL. Set `MIGRATIONS_TEST_DATABASE_URL` to a local `/postgres` URL for an account with `CREATEDB`; remote hosts are rejected.

Cloudinary credentials, the Clerk secret and Paystack secret are server-only. Optional Manus Maps/service values are unrelated to login. The static bundle must never contain a server credential.

## Paystack checkout and seller payouts

Paystack is not configured. Do not accept test or live charges until a test `PAYSTACK_SECRET_KEY` and webhook endpoint are added and verified. The server calculates totals in integer kobo, reserves stock transactionally, and requires provider-verified reference, amount and NGN currency before confirming orders. The browser redirects to Paystack-hosted checkout; NaijaKoblas never collects card number, expiry or CVV.

Payments currently settle to the marketplace account. Seller subaccounts, commission splits and vendor payouts are not implemented. Define commissions, seller bank verification, refunds/chargebacks, reconciliation and settlement rules before routing funds to vendors. See [backend research](backend-research.md) and the implementation checklist in [TODO.md](TODO.md).

## Validation and remaining blockers

Current local checks pass: `pnpm check`, 19 test files/94 tests, production and static builds, and `git diff --check`. The checked-in PostgreSQL migration integration harness and prior disposable-database migration runs passed their regression scenarios. The Fly v11 release command completed successfully with the protected admin catalog/audit procedures and no schema changes. Smoke checks confirmed direct and proxied health/auth-status HTTP 200, direct Fly catalog health, and Vercel production routes plus the deployed bundle confirmed role-aware navigation and the new admin workspace. No authenticated customer was used to exercise seller activation end-to-end, and no password or credentials were created or shared. Cloudinary and owner bootstrap secrets are configured; remaining work is to test a real seller upload and the protected admin flow, then configure/test Paystack. Live charges and vendor payouts remain disabled.
