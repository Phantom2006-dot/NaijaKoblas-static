# NaijaKoblas

NaijaKoblas is a Nigerian leather-goods multi-vendor marketplace. The stack is React/Vite, Express/tRPC, Neon PostgreSQL, Clerk email/password identity and Paystack-hosted checkout. Live payments, vendor splits and payouts remain disabled.

## Test deployment status

- **Storefront:** [https://naijakoblas-static.vercel.app](https://naijakoblas-static.vercel.app)
- **Sign up:** [https://naijakoblas-static.vercel.app/signup](https://naijakoblas-static.vercel.app/signup)
- **Sign in:** [https://naijakoblas-static.vercel.app/login](https://naijakoblas-static.vercel.app/login)
- **Headless administrator entry:** [https://naijakoblas-static.vercel.app/admin](https://naijakoblas-static.vercel.app/admin)
- **API host:** [https://naijakoblas-static.fly.dev](https://naijakoblas-static.fly.dev)
- **Health:** `https://naijakoblas-static.vercel.app/api/health`
- **Paystack webhook path for future test setup:** `https://naijakoblas-static.vercel.app/api/payments/paystack/webhook`

The workflow code is on GitHub `main` at `eaea087` and is included in READY Vercel production with the new `/admin`, role-aware seller/staff workspaces, gallery and notification UI. Fly release v9 now serves image `marketplace-eaea087`; its release command completed successfully. Vercel's `/api/*` proxy reaches the updated API. Direct and proxied health/auth-status checks returned HTTP 200, the browser/API Clerk publishable keys matched, and the public catalog query returned HTTP 200 with zero listings in the empty test database.

The selected Fly app `naijakoblas-static` uses one `shared-cpu-1x` 512 MB machine in Amsterdam, port 3000, with autostart and stop-on-idle. The single machine was stopped after smoke tests to minimize idle compute; requests will autostart it. No duplicate persistent machine or dedicated IPv4 was created. `DATABASE_URL`, `APP_BASE_URL`, and the Clerk key pair are protected Fly secrets; values are not committed or printed. `DATABASE_URL_UNPOOLED` is not configured, so the successful release migration used the runner's pooled-URL fallback. The obsolete `MANUS_JWT_SECRET` was removed. `OWNER_CLERK_USER_ID` is not set yet.

## Clerk accounts and role boundaries

Clerk is the only end-user identity provider. It handles password storage, verification and recovery; NaijaKoblas does not store password hashes. Every authenticated API request checks the current Clerk profile and requires a verified primary email before account synchronization or authorization. Application roles live in Neon and cannot be supplied by the browser or Clerk metadata.

The dedicated **NaijaKoblas** Clerk development app has email/password sign-up, required email verification by one-time code, Google sign-in disabled, a 15-character minimum password, compromised-password rejection, and email-code sign-in enabled. If you have not registered in this new app, use [Create account](https://naijakoblas-static.vercel.app/signup), verify the email, then use [Sign in](https://naijakoblas-static.vercel.app/login). Existing Manus OAuth sessions were not imported. Keep passwords and verification codes private.

The `/admin` route is a separate headless entry outside the storefront shell and has no public-navigation link. It uses the same Clerk identity, then checks the Neon role; only `admin` can see administrator tools. Staff and sellers cannot gain administrator access by knowing the route. The first administrator is bootstrapped once for the exact configured `OWNER_CLERK_USER_ID`, only after verified sign-in and only if no administrator exists. The owner ID and bootstrap have not yet been configured/tested; a new signup remains a customer until the owner ID is set.

## Seller, staff and administrator workflow

An approved seller keeps one Clerk account for shopping and store management. The signed-in navigation exposes a Seller Workspace or Staff Portal link for the corresponding database role; `/account` also links into the role workspace. The seller dashboard links back to customer account functions. Customer/staff/seller identity is not switched or impersonated; permissions remain database-authoritative.

Sellers create their own draft listings. Staff and administrators can select an approved seller with an active store and create a draft listing on that seller’s behalf. It remains seller-owned and unpublished; the seller must review it, add/select a primary product photo, and have available stock before publishing. Staff/admin cannot publish it on the seller’s behalf.

Product images use an authenticated multipart Express endpoint and durable Cloudinary storage—not the Fly filesystem. The server validates the verified Clerk account, database role, seller approval/store status, product ownership, JPEG/PNG/WebP MIME and file signatures. Each file is at most 8 MB, a batch contains at most four images/32 MB combined, and a listing can contain ten images total. Upload authorization occurs before multipart parsing and is rechecked in the database transaction. Only one upload batch per API process can be active; that slot stays held until parsing, Cloudinary/database work and any cleanup finish, even if the client disconnects. Requests are limited to 12 batches per account per 10-minute process-local window. Cloudinary cleanup on database failure is retried three times and logs a warning if compensation still fails; a durable orphan-asset reconciler is future operational work. Keyboard users receive visible focus indicators; the mobile menu traps Tab/Shift+Tab and closes with Escape/outside dismissal, and the mobile filter drawer provides a focus-contained, dismissible dialog.

**Cloudinary app credentials are not currently present in Fly.** Before photo uploads can work, add these protected Fly secrets: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. Until configured, an authenticated upload attempt intentionally receives a storage-setup response; unauthenticated requests are rejected with HTTP 401 before parsing.

A signed-in notification bell shows recipient-scoped in-app events for seller applications/reviews, verified payment, fulfillment, staff-created drafts/photos and staff access changes. Defined seller/role notification events are persisted in the same database transactions as their business state changes; notification event keys are idempotent and long keys use a digest. The bell polls every 45 seconds and supports marking one/all read. This is an **in-app inbox only**; email, SMS, push or background-channel delivery is not implemented.

## Database migrations and safe recovery

Use pooled `DATABASE_URL` for application queries and direct `DATABASE_URL_UNPOOLED` for schema migrations where available. Migrations live in `drizzle/postgres/`; historical root `drizzle/0000_initial_users.sql` and `drizzle/0001_tense_shape.sql` are legacy MySQL files and must not be applied to Neon. Fly’s release command runs the compiled migration runner before a new API release starts. Both `pnpm db:migrate` and `pnpm db:push` route through this same custom runner; they do not call `drizzle-kit migrate` directly.

The Neon test database already contained the approved initial PostgreSQL baseline, but that baseline was applied before its Drizzle migration-ledger entry existed. Fly release v8 safely aborted on the existing `account_role` enum; its baseline transaction rolled back, so the gallery/notification migrations did not apply in that attempt. Drizzle creates its bookkeeping schema/table before its transaction, so that failed attempt may have left only an empty `drizzle.__drizzle_migrations` table. The new Fly v9 release completed the recovery runner and pending migrations successfully.

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

Current local checks pass: `pnpm check`, 17 unit-test files/85 tests, production and static builds, `git diff --check`, strict Fly config validation and the Linux/AMD64 image build (74,842,796 bytes). The checked-in PostgreSQL integration harness passed its complete regression matrix, including fresh/pre-applied baselines, data preservation, mismatch/stale-object/history refusal, constraint-only/data-only/sequence-owner checks, ambient search path and concurrency. The package `pnpm db:migrate` command was separately applied twice to a disposable local database and ended with exactly three migration rows. The independent migration audit found no high/medium code issues; it did not query Neon, but the v9 release command completed and the live gallery-aware catalog query passed. Smoke checks confirmed direct and proxied health/auth-status HTTP 200, matching browser/API Clerk keys, login/signup/admin routes HTTP 200, the empty catalog HTTP 200, and HTTP 401 from an unauthenticated upload. The single Fly machine was stopped after these checks. Remaining work: add Cloudinary secrets and test a real approved seller upload; create/verify the owner account and set `OWNER_CLERK_USER_ID`; configure/test Paystack. Live charges and vendor payouts remain disabled.
