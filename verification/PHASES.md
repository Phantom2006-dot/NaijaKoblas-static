# Phased implementation evidence

This upgrade begins from Git commit `1e17e28a8189161d3c4884795ba42641eaa4592c`. Work is isolated on `feat/verified-commerce-upgrade`; this session has not deployed or written to Neon, Clerk, Cloudinary or Paystack. All persistence fixtures live in random temporary localhost PostgreSQL databases and are removed after checks.

## Baseline — PASS (2026-11-05)

`pnpm install --frozen-lockfile` completed using the existing pnpm 10.18.0 pin and reviewed esbuild/Tailwind lifecycle permissions. `pnpm ignored-builds` reported none. The untouched repository passed `pnpm check`, 19 test files / 94 tests, `pnpm build` and `git diff --check`. Evidence: `verification/baseline.log`.

The existing nine-case local migration regression matrix passed, including repeat application, pre-applied baseline adoption/data preservation, schema mismatch refusal, unledgered targets, history gaps and concurrent runners. Evidence: `verification/migrations-baseline.log`.

Existing build warnings: Vite cannot bundle the intentional runtime platform-config script as a module; the single frontend JavaScript chunk exceeds 500 kB. Neither is a baseline failure. The upgrade will address payload splitting where appropriate rather than hiding the warning.

## Phase 1 — protected backend contracts — PASS (2026-11-05)

Composed both new routers under the existing `adminProcedure`-protected `admin` namespace. `pnpm check` passed; 21 test files / 106 tests passed; full production build passed. The product integration used an isolated random localhost database and verified seller-owned draft creation/notification, protected listing/detail, real name/price/stock edits visible from the public catalog, stale-edit conflict, pending-reservation block, order-history deletion refusal/archive, gallery primary/removal, final-image unpublishing, audit actor and role boundaries. The operations integration used its own temporary database and verified exact totals/revenue (only verified and eligible orders), recent sales, bounded search/pagination, sanitized details/customer history, all paid fulfillment transitions, actor audit, unpaid fulfillment rejection and unchanged payment state. Each test database received the existing migrations twice and was removed. No test touched Neon or provider services.

Evidence: `verification/phase1.log`; `server/admin/products.integration.ts`; `server/admin/operations.integration.ts`.

## Phase 2 — admin workflows — PASS (2026-11-05)

Starts from a fully verified backend. Implement the protected responsive admin shell, product editor/management, real overview/sales charts, orders, customers, categories and provider settings, keeping the existing account-role controls/reconciliation/staff intake/audit accessible. Verify UI typecheck/build/routes and repeat actual product/order persistence after integration.

The protected admin shell, catalog editor, operations pages and route manifests are implemented. The Phase 2 gate passed `pnpm check`, all 106 unit tests, full and static production builds, both disposable product/operations persistence suites, and `git diff --check`. Build warnings remain limited to the intentional runtime platform-config script and the existing large frontend chunk.

## Phase 3 — public/contact/subscription improvements — SLICE PASS (2026-11-09)

The first public slice is verified: catalog data refreshes on window focus/visibility, the public price filter no longer caps listings at ₦200,000, newsletter/waitlist/contact submissions use validated tRPC procedures with process-local abuse limits, contact messages and subscriptions persist through reviewed migration `0003_honest_contacts`, duplicate subscription emails are normalized/deduplicated, and administrators can search and update the protected contact inbox. The new disposable submissions suite passed after applying migrations twice and verified contact persistence, subscription deduplication, inbox search and status updates. The complete editorial Home/About rewrite and any additional public polish remain open; Phase 4 cannot start yet.

## Phase 4 — final regression audit and handoff (NOT STARTED)

Starts only after Phase 3 checks pass. A code/local database check is not a live Clerk login, Cloudinary upload, or Paystack transaction test; these require controlled real credentials and are recorded separately.
