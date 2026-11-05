# NaijaKoblas implementation plan

## Storefront and runtime boundary

Keep the existing React storefront and Express/tRPC backend. Vercel serves the static Vite build at `https://naijakoblas-static.vercel.app`; its `/api/*` rewrite forwards API and Paystack webhook requests to `https://naijakoblas-static.fly.dev` before the SPA fallback. This same-origin boundary keeps browser requests and Clerk token-bearing tRPC calls on the storefront origin. Production is a public test deployment; Vercel previews remain protected. Reuse NaijaKoblas's existing dark-green/black/cream visual language and build compact private workspaces rather than redesigning the public store.

Fly runs the API in Amsterdam on one `shared-cpu-1x` 512 MB machine, listening on port 3000. HTTPS health checks, autostart and stop-on-idle are configured, with a shared IPv4. Fly meters compute while a machine runs; auto-stop reduces idle compute use.

## Clerk-only identity and application roles

Clerk is the sole end-user identity provider for email/password sign-in, verification and password recovery. The browser obtains a Clerk session JWT and sends it to tRPC as a Bearer token. Express validates the complete server key pair and exact `APP_BASE_URL` origin before installing middleware; the origin is always supplied as `authorizedParties`. Production origins must use HTTPS. When both server Clerk keys are absent, public storefront/health stay available while account access is disabled; a partial key pair, missing origin with auth enabled or invalid origin fails closed.

Before mounting `ClerkProvider`, the client fetches uncached auth status and checks its public key matches the server key. Auth hooks are safe outside the provider. Every authenticated API request reads the authoritative Clerk user and requires its current primary email to be verified before account lookup/sync or owner bootstrap. Neon owns the `customer | seller | staff | admin` role; neither client input nor Clerk metadata may grant a role. Existing physical `openId` stores the Clerk user ID for the fresh test schema.

Customers apply to sell; staff/admin review applications. Approval activates the seller role/store. Suspension removes catalog controls while a narrow owner-scoped fulfillment permission can remain for already-paid order lines. Customer, seller and staff workspaces are accessible through role-aware account/header links. This is one identity and no impersonation or client-selectable role. The private `/admin` route is outside the storefront shell and absent from public navigation; it uses Clerk sign-in and then gates all administration data/procedures on the Neon admin role. A customer or staff member who guesses `/admin` receives no admin data. The exact `OWNER_CLERK_USER_ID` may bootstrap the first admin once only after verified sign-in and only before any existing admin; audit the transition.

## Staff/seller product-media workflow

Keep seller ownership immutable. A seller creates a draft listing under their own user ID. Staff/admin can select an approved seller with an active store and create a draft on that seller's behalf; the draft remains private and seller-owned until the seller reviews and publishes it. Publication requires available stock and a selected primary gallery photo. A dedicated listing gallery supports up to ten images.

Store photos durably in Cloudinary using an authenticated, server-only multipart endpoint; never use Fly's ephemeral filesystem or accept new arbitrary external image URLs. Check Clerk verified identity and database role/ownership before parsing, then recheck relevant role/store/product ownership transactionally when writing metadata. Accept only JPEG, PNG and WebP with server-side magic-byte validation. Limit each file to 8 MB and each request to four files/32 MB, allow only one in-flight upload batch per API process, and rate-limit to 12 batches per account per 10-minute process-local window. The concurrency slot remains held until multipart errors are drained or all provider/database work and compensation finishes; never release solely because the client response socket closes. The browser presents the same limits and safe errors. Retry Cloudinary cleanup three times when metadata persistence fails and log unresolved cleanup; a durable orphan-asset reconciler remains future work. Keep pre-existing HTTPS primary-image URLs as explicit `external` legacy gallery entries, with a database check allowing only the documented formats.

## Database migration boundary

`drizzle/postgres/0001_married_dagger.sql` adds gallery and recipient-scoped inbox tables and backfills legacy primary images; `0002_aspiring_iceman.sql` constrains the stored image-format contract. Fly's release command and the normal `pnpm db:migrate` / `pnpm db:push` commands all use the custom migration runner, never `drizzle-kit migrate` directly.

The pre-applied Neon baseline predates its Drizzle ledger record. A Fly v8 attempt aborted safely on the existing `account_role` enum; its baseline migration transaction rolled back, though an empty bookkeeping table may have been created before the failed transaction. The runner uses a transaction-scoped advisory lock, sets local `search_path` to `public`, validates an exact ordered journal prefix, and fingerprints the baseline by replaying its DDL in a scratch schema and comparing enum labels, table columns/types/defaults, constraints/FKs, indexes and owned sequence definitions/columns. It adopts the baseline only on exact match and only with an empty ledger. Before replaying pending migrations, it refuses any unledgered table/enum/index/sequence/constraint collision or data target in an existing table; all DDL and history rows commit atomically. The parser recognizes one top-level statement per Drizzle SQL chunk, skips semicolons only while inside quoted values/identifiers/dollar strings, rejects comments/multiple commands and `USING INDEX`, and fails closed on unknown grammar. `db:push` first generates SQL, then the custom runner applies only the reviewed supported forms. The scratch schema is cleaned in a `finally` path. Partial/mismatched schemas and conflicting/gapped histories fail closed. The checked-in localhost-only integration harness covers fresh DB with unsafe ambient search path, pre-applied baseline/data preservation, altered enum, sequence-owner mismatch, unledgered later object, constraint-only and data-only migration targets, history gap and concurrent runners. It refuses remote hosts and drops only its own random temporary test DBs. Do not apply historical root MySQL migrations to Neon.

## Recipient-scoped in-app notifications and accessibility

Persist marketplace inbox items in Neon, scoped by recipient and idempotent event key. Emit seller-application submitted/reviewed, staff-access, staff-created draft/photo, payment and fulfillment events from the same database transaction as their respective state change wherever implemented. Links must remain same-origin; recipients may mark one/all read. The notification bell polls every 45 seconds and provides keyboard dismissal, focus return and explicit read/unread labeling. The public mobile navigation is a disclosure that traps Tab/Shift+Tab while open, handles Escape/outside close and restores focus; the full-screen filter drawer locks background scroll, traps keyboard focus and returns focus on all close paths. All interactive controls have visible `:focus-visible` indicators. This is in-app delivery only; no SMS/email/push, delivery worker or durable notification delivery queue is included.

## Customer commerce and payment boundary

The public catalog exposes only published, in-stock products from active stores. Checkout sends product IDs, quantities, sizes, delivery details and a customer-scoped idempotency key—not client prices or totals. The server locks product/store rows, reserves inventory transactionally, binds the key to a canonical request, snapshots seller ownership and computes totals in integer kobo. Customer accounts show private order history and resumable pending payment links. Seller dashboards manage owned listings/stock and per-item fulfillment; customer contact details appear only for paid order fulfillment. Manual admin payment reconciliation verifies provider status and records the acting administrator.

Paystack remains the Nigeria-focused hosted-checkout provider; test credentials are not configured. The server initializes transactions from persisted order totals; signed raw-body webhooks and server verification require matching reference, amount and NGN currency before marking an order paid. Verified failed/abandoned/reversed transactions release stock only while payment remains pending; ambiguous timeouts stay reserved for reconciliation. Payments settle to the marketplace account only. Seller subaccounts, commissions, automatic payouts, refunds/returns and settlement policy are not implemented; keep live payments disabled until business and compliance rules are defined.

## Current deployment and remaining work

Workflow/frontend commit `194c033` and migration hardening follow-up `eaea087` are on GitHub `main`; Vercel production is READY and Fly release v9 runs image `marketplace-eaea087` on the existing single 512 MB machine. Its pre-release migration command completed successfully, adopting the pre-applied baseline and applying the gallery/notification migrations. Direct and proxied API health/auth status passed, the Vercel and Fly Clerk publishable keys match, and the gallery-aware public catalog returns HTTP 200 with an empty test catalog. The machine is stopped after smoke testing and autostarts on request.

The current tree passes TypeScript, 85 unit tests, production/static builds, `pnpm db:migrate` apply-twice against a disposable local DB, the nine-case localhost PostgreSQL integration matrix, strict Fly config validation and a 74.8 MB AMD64 image build. A fresh independent audit found no high/medium issues in the migration runner, parser or package scripts; it did not connect to Neon, while the actual Fly release runner and post-release catalog check succeeded. `DATABASE_URL_UNPOOLED` is not configured, so migration used the pooled `DATABASE_URL` fallback successfully. Cloudinary credentials are absent, so authenticated product image upload remains deliberately disabled until protected secrets are added. `OWNER_CLERK_USER_ID` and a controlled seller/listing are not configured; first-admin, seller upload and staff intake have not been tested with a real account. Paystack remains unconfigured. Add Cloudinary secrets, verify the owner account/first-admin bootstrap, seed a controlled seller/listing, then test uploads and the Paystack test/webhook flow; do not enable seller payouts or live payments.


## Approved role workflow improvement plan

The existing four-role model remains: customer, seller, staff and admin. The public shell keeps task-first navigation and uses role-specific workspace links only where the content is genuinely unique. Anonymous visitors see public shopping and sign-in; customers see Become a Seller; sellers see Seller Workspace; staff see Staff Portal; administrators see Admin Portal. Sellers retain Account and shopping access.

Phase 1 replaces unconditional seller-acquisition links with a shared effective-role policy across the header, footer, homepage and About page, and synchronizes all route manifests. Auth-loading states avoid flashing the wrong role. The supplied NaijaKoblas reference informs the existing dark forest, bone, terracotta and lime visual language.

The first protected admin increment adds a workspace shell with Overview, Catalog and Audit sections. Catalog reads cover all product statuses, seller/store ownership, stock, image count/primary state and timestamps. Audit reads are bounded, admin-only, actor-aware and redact secret-like metadata. Existing overview, payment reconciliation, staff access and staff intake remain protected; staff intake is shown only on Overview.

Future phases add first-class audit targets and product/order/payment events, then Orders, Payments, Sellers, People and Operations sections. Staff queues and seller listing readiness are improved separately without weakening ownership, suspension or payment boundaries. See `ROLE_WORKFLOW_AUDIT.md` and the `audit-*.md` reports for evidence and source references.


## Mobile responsive visual pass

Use 42.fr as inspiration for behavior, not branding: mobile-first full-screen navigation, progressive editorial sections, clear statistics blocks, and restrained reveal/slide motion. Keep NaijaKoblas’s forest, bone, terracotta, lime and leather-gold palette, Syne display type and product-first hierarchy.

The implementation will consolidate the final mobile cascade so the header has one predictable breakpoint, the menu animates as a contained full-screen drawer with backdrop and focus behavior, page content cannot create horizontal overflow, product/catalog grids remain tappable, forms and portal rows stack cleanly, and the fixed bottom navigation reserves safe-area space. Add lightweight reveal and hover/tap motion with `prefers-reduced-motion` fallbacks. Do not introduce a new animation library or alter commerce/auth behavior.

## November 2026 functional e-commerce upgrade

Continue this repository in verified phases, not a replacement website. GitHub review branch delivery is the current execution path because the saved Webdev identity is unavailable to this session. Do not deploy or modify Neon during development. The existing Clerk provider, verified-email checks, database-owned roles, Vercel/Fly split, Cloudinary endpoint, Paystack verification and seller ownership remain in place.

### Phase 1 — baseline and backend contracts

Establish the untouched TypeScript/test/build baseline, then extend the existing tRPC/Drizzle architecture through focused `server/admin` modules. Add admin-authorized product detail, filtered/sorted/paginated product management, seller-owned draft creation, real database edits, safe deletion for products without order history, archive for historical products, primary-photo selection and gallery removal. Keep stock reservation protections, immutable ownership and seller-controlled publication. Add actual database overview/sales aggregates, bounded order/customer records and paid-order fulfillment transitions, preserving payment-provider verification and not inventing refund/cancellation behavior. Category management uses categories already stored on product records rather than a new taxonomy schema.

### Phase 2 — functional admin workflows

Replace the unfinished operations surface with a responsive forest-and-bone administration shell, sidebar and contextual topbar, retaining the existing admin gate, notifications and Clerk logout. Connect forms/tables to phase-1 procedures with validation, save/cancel, confirmation dialogs, pagination, image previews and explicit server errors. Overview and Analytics show real counts, paid revenue and zero/empty states; Orders and Customers expose real records; Settings shows provider readiness without secrets. Preserve account-role controls, payment reconciliation, staff intake and audit access.

### Phase 3 — public storefront and honest contact/subscriptions

Reuse the existing product photography, logos, Syne typography and forest/bone/terracotta/lime palette. Improve catalog search/category/price sorting and loading/empty states, remove the implicit price ceiling, refresh the shared catalog after admin saves and on visitor refocus, and keep checkout/wishlist/cart behavior. Improve editorial Home/About hierarchy and factual brand copy. Replace contact/newsletter fake-success handlers with durable Postgres submission storage, validated tRPC endpoints, abuse limits and admin inbox access; any new tables must use reviewed Postgres migrations through the existing custom runner. Success means stored for administration, not an email that was never sent. Do not make unsupported shipping, return, verification or response-time promises. Restrained CSS micro-interactions and reduced-motion support require no new animation dependency.

### Phase 4 — final regression audit and handoff

Run the existing suite plus new admin/public behavior tests, production/static builds, local disposable-Postgres persistence and migration checks, and a read-only independent wiring/security audit. Record the result of each phase in `verification/PHASES.md`; do not advance past confirmed failures. Add deployment instructions and clearly distinguish code/local database proof from authenticated live Clerk/Cloudinary/Paystack tests that cannot be performed without controlled live access. Push verified commits to a new GitHub branch and open a pull request; do not silently update production.

### Project structure and integration

- `client/src/pages/admin`: focused admin overview/catalog/editor/order/customer/analytics/settings views.
- `client/src/pages/AdminWorkspacePage.tsx`: admin shell and section routing; `AdminAccessPage.tsx` retains the authentication/authorization gate.
- `client/src/components/store`: existing storefront cards, notifications and image upload component, extended without duplicated providers.
- `server/admin`: new protected product and operations modules composed into `server/routers.ts`; `server/db.ts` remains the shared connection and existing commerce data layer.
- `shared`: browser/server-safe validation and catalog utilities where genuinely shared.
- `drizzle/schema.ts` / `drizzle/postgres`: only necessary durable contact/subscription additions; no replacement product/order/auth schema.
- `scripts` / `server/**/*.test.ts` / `verification`: reproducible localhost-only persistence checks and phase evidence.

### Design continuation

Keep NaijaKoblas's Nigerian leather-craft identity. Admin: quiet bone surfaces, forest sidebar, lime accents only for key actions, Syne headings, compact readable tables and generous form labels. Public: asymmetric editorial hero, original product imagery, premium craft story and clear shopping CTAs. Motion remains short opacity/transform feedback, never essential to comprehension, with visible focus states and reduced-motion overrides. No decorative dashboard illustrations or fabricated statistics.
