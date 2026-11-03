# Admin dashboard operations and auditability audit

**Scope.** This audit covers the checked-in application at `/home/ubuntu/workspace/NaijaKoblas-static`: admin routes, database functions, admin mutations, payment reconciliation, role management, audit events, and product/order/catalog visibility. No application code was changed; this file is the only artifact added.

## Executive assessment

Authorization is principally server-side and is stronger than the current admin information architecture. Clerk supplies identity, the server requires a verified primary email, the Neon `users.role` is authoritative, and `adminProcedure` requires the database role `admin`. The current `/admin` page is therefore not an authorization bypass, but it is an incomplete operations console. It exposes only a capped user list, pending Paystack queue, staff grant/revoke, and the staff product-intake component. An administrator cannot inspect the full product inventory, every image/asset taken into the site, stores/sellers, orders/order lines, payment history, fulfillment state, or the append-only audit trail from the product UI.

The existing `accountAuditEvents` table records several important state transitions, but it is account-oriented (`actorUserId`, `targetUserId`, `eventType`, JSON metadata), has no admin read procedure, no product/order/payment foreign-key targets, and no immutability enforcement beyond application convention. It also does not consistently record all mutations. In particular, seller product create/update/archive, seller-owned image uploads, inventory changes caused by checkout/failure, and admin reads/exports are not represented as product/order audit events. The fulfillment audit currently writes `actorUserId: input.sellerUserId`, which is the seller owner rather than the authenticated actor; this is wrong for the suspended-customer fulfillment path and should be corrected before relying on audit evidence.

## Current routes and authorization

- `client/src/App.tsx:16-40` registers `/admin`, `/staff`, `/seller`, and `/account`. `/admin` is outside the storefront shell, but routing is client-side and is not an authorization boundary.
- `client/src/pages/AdminAccessPage.tsx:27-59` calls `trpc.auth.me` and renders the admin dashboard only when the server-returned role is `admin`; non-admins receive no admin data. This is good UX gating, not a substitute for server checks.
- `server/_core/context.ts:18-52` validates the Clerk session and verified primary email, syncs the Clerk identity into `users`, and can run the one-time configured-owner bootstrap.
- `server/_core/trpc.ts:42-50` defines `adminProcedure` using `requireRole(ctx.user, ["admin"])`; `staffProcedure` uses the seller-review capability. `server/_core/authorization.ts:12-17,56-72` maps roles to capabilities and rejects missing/incorrect roles.
- `server/routers.ts:328-400` is the complete admin router today: `admin.users`, `admin.pendingPayments`, `admin.reconcilePayment`, and `admin.setStaffAccess`. There are no admin products, orders, stores, audit, image, catalog-health, or export procedures.

**Authorization conclusion.** Keep all proposed admin reads and writes on `adminProcedure`; do not accept role, actor, seller, or customer IDs from the client as authority. For any mutation, derive `actorUserId` from `ctx.user.id`, lock the target row, re-check current state and role in the transaction, and write the audit event in the same transaction as the business mutation. Staff may retain only the explicitly existing seller-review/intake capabilities; do not broaden `staffProcedure` to the proposed financial or account-wide admin surfaces without a separate capability decision.

## Existing data model and visibility

`drizzle/schema.ts` defines the relevant operational records:

- `users` (`:39-49`) with `customer | seller | staff | admin` role.
- `adminBootstrap` (`:51-56`) for one-time first-admin protection.
- `sellerApplications` (`:58-78`) and `sellerStores` (`:125-135`) for seller state.
- `accountAuditEvents` (`:80-91`) as an append-only-by-convention account/seller-review trail.
- `sellerProducts` (`:137-156`) with seller owner, name, description, category, price, one legacy `imageUrl`, sizes, inventory, status, and timestamps.
- `sellerProductImages` (`:158-180`) with URL/provider IDs, dimensions, format, creator, ordering, and primary flag.
- `orders` (`:182-209`) with customer, status, delivery/contact snapshot, and NGN totals.
- `orderItems` (`:211-232`) with product/seller snapshots, quantity/price, and fulfillment state.
- `paymentTransactions` (`:234-256`) with one Paystack transaction per order, provider reference, status, amount, checkout URL, provider transaction ID, and verification time.

The schema has useful status/category/payment indexes, but no audit event type index, no product/order/payment IDs as first-class audit targets, and no indexes designed for an admin activity feed or product asset ledger.

## What is implemented today

### Admin reads and mutations

`server/db.ts:179-189` implements `listUsersForAdmin()`, selecting only id/name/email/role/createdAt/lastSignedIn and hard-limiting to 200, with no cursor. `server/db.ts:191-210` implements `listPendingPaymentsForAdmin()` with cursor-by-payment-id and a maximum page size of 100, but returns only pending transactions whose order remains `pending_payment`. `server/routers.ts:329-333` exposes these reads.

`server/db.ts:539-577` implements `changeStaffAccess()`. It is transactionally guarded: it blocks self-change, protects admins, permits only customer→staff and staff→customer, updates conditionally on the expected role, writes an audit event, and creates a notification. `server/routers.ts:387-400` exposes it using the authenticated admin context. There is deliberately no admin mutation for promoting/revoking administrators, which is safer than a general role editor but leaves a documented operational gap for controlled admin lifecycle management.

`server/db.ts:132-163` bootstraps only the configured owner identity, only if no admin/bootstrap marker exists, only from customer role, and records `initial_admin_bootstrapped`. This is a sound fail-closed first-admin design; the production checklist states it has not been exercised with a real account (`TODO.md:31-33`).

### Product/catalog operations

Public catalog visibility is only `server/routers.ts:81-83` → `db.listPublicSellerProducts()`, which is limited to published products, in-stock products, and active stores (the implementation is in `server/db.ts` around the public catalog function). Seller visibility is owner-scoped: `server/db.ts:643-649` lists up to 100 products for the seller and joins gallery images. Seller product creation/update is exposed at `server/routers.ts:226-250`; staff can create a draft for an approved active seller at `:291-308`, implemented transactionally in `server/db.ts:681-723`.

The admin has no read path for all products, including drafts, archived records, out-of-stock records, seller ownership, store state, image provenance, or publication history. The current admin page embeds `StaffProductIntakePanel` (`client/src/pages/AdminAccessPage.tsx:59`) but that is a create-draft/upload workflow, not an inventory/catalog ledger. Product images are durably represented in `sellerProductImages`, and upload ownership/security checks are implemented in `server/db.ts:758-835`, but there is no admin gallery/asset listing and no image audit for seller-owned uploads. Staff-created drafts and staff-uploaded images do generate account audit events (`server/db.ts:708-713,819-825`); ordinary seller create/update/upload paths do not provide equivalent product event records.

### Orders, fulfillment, and payment reconciliation

Customers see only their own orders through `server/routers.ts:114-201` and `server/db.ts:1112-1145`. Sellers see only paid orders containing their own lines through `server/db.ts:1291-1314`. There is no admin order list or order detail query, so an admin cannot inspect customer/order snapshots, item-level seller assignments, fulfillment progression, inventory reservation history, or a failed/mismatched payment in context.

Checkout is robustly server-owned: `server/db.ts:952-1090` locks catalog/store rows, validates published/active/stock/size, computes integer-kobo totals, decrements inventory transactionally, stores order/item snapshots, creates a pending Paystack row, and writes `order_created_pending_payment`. A provider failure restores inventory and writes `payment_failed_stock_released` (`server/db.ts:1244-1288`). Successful verification requires reference, amount, and NGN currency matching, prevents provider transaction reuse, transitions payment/order atomically, and writes `payment_verified` (`server/db.ts:1155-1242`).

Admin reconciliation is exposed at `server/routers.ts:334-386`: it reads a reference, verifies with Paystack, classifies success/failed/pending/mismatch via `server/payments/reconciliation.ts:5-17`, and passes `ctx.user.id` into the payment mutation. This is a good narrow mutation and preserves pending state on provider errors/mismatches. However, the admin queue excludes already-succeeded/failed transactions and there is no historical payment search, reconciliation history, mismatch queue, provider response evidence, or order detail view. `TODO.md:19,26,33` confirms Paystack credentials and end-to-end payment/reconciliation testing are not configured/exercised; live payments remain disabled.

Fulfillment writes `seller_order_item_fulfillment_updated` (`server/db.ts:1316-1389`) but uses `actorUserId: input.sellerUserId` (`:1368-1372`). The router allows a suspended customer with narrow fulfillment access (`server/routers.ts:260-287` and `server/_core/authorization.ts:52-54`), so the recorded actor can be incorrect. The mutation signature must include the authenticated actor separately and audit `ctx.user.id`.

### Audit event coverage

Current event types written in `server/db.ts` are:

- `initial_admin_bootstrapped` (`:156-160`)
- `seller_application_submitted` (`:241-245`)
- `seller_self_activated` (`:372-375`)
- `seller_store_profile_updated` (`:432-435`)
- `seller_application_status_changed` (`:515-519`)
- `staff_access_granted` / `staff_access_revoked` (`:559-563`)
- `staff_created_seller_product_draft` (`:708-712`)
- `staff_uploaded_seller_product_images` (`:820-824`)
- `order_created_pending_payment` (`:1077-1082`)
- `payment_verified` (`:1202-1211`)
- `payment_failed_stock_released` (`:1269-1277`)
- `seller_order_item_fulfillment_updated` (`:1368-1378`)

There is no read function for `accountAuditEvents` anywhere in `server/db.ts`, no `admin.audit` router, no audit UI, and no export. The table has nullable actor/target user FKs with `ON DELETE SET NULL`, which preserves rows but can make historical attribution less readable after account deletion. Metadata is untyped JSON and can contain sensitive order/customer information without a documented redaction policy. There is also no database trigger/privilege policy preventing direct UPDATE/DELETE; the “append-only” guarantee currently depends on application discipline and database credentials.

## Findings

1. **High — Admin cannot see the full operational catalog or product intake ledger.** There is no admin product query/page. Draft, published, archived, out-of-stock, inactive-store, seller owner, image count/provenance, and last-change data are unavailable to operators. This directly fails the requirement for detailed logs of all products taken into the site. Evidence: `server/routers.ts:328-400`; `client/src/pages/AccountPages.tsx:174-197`; product tables `drizzle/schema.ts:137-180`.

2. **High — Admin cannot inspect orders/order lines or payment history beyond currently pending reconciliation.** Customer and seller queries are intentionally scoped, but there is no privileged equivalent. Operators cannot correlate order status, item/seller snapshots, fulfillment, payment transaction, and inventory effects. Evidence: `server/db.ts:1112-1145,1291-1314`; `server/routers.ts:330-386`.

3. **High — Auditability is not product/order-complete and has no admin read surface.** Events exist but are account-oriented, metadata-only for commerce targets, and cannot be searched or exported. Product create/update/archive, ordinary image uploads, stock reservations/releases, and many admin reads are absent. Evidence: `drizzle/schema.ts:80-91`; all writes listed above; no `accountAuditEvents` read in `server/`.

4. **High — Fulfillment audit actor attribution is incorrect for the suspended-customer path.** `updateSellerOrderItemFulfillment` records the seller owner as actor instead of the authenticated requester. Evidence: `server/db.ts:1316-1389`, specifically `:1368-1372`; access path `server/routers.ts:261-287`.

5. **Medium — User/role administration is capped and not operationally complete.** `listUsersForAdmin()` returns at most 200 users with no cursor/filter/search and the UI has no role history, last activity, seller/store linkage, or audit drill-down. Admins can only grant/revoke staff; admin lifecycle is intentionally unavailable and should remain guarded rather than added as a generic role dropdown. Evidence: `server/db.ts:179-189`; `server/routers.ts:387-400`; `client/src/pages/AccountPages.tsx:195`.

6. **Medium — Payment reconciliation is safe but too narrow for investigation.** The queue is only pending/pending-payment, with no historical reconciliation attempts, mismatch records, provider status payload/reference metadata, or admin order context. Current environment/configuration has not exercised Paystack end to end. Evidence: `server/db.ts:191-210,1155-1288`; `server/payments/reconciliation.ts:5-17`; `TODO.md:19,26,33`.

7. **Medium — “Append-only” audit is not enforced at the database boundary.** The schema has no event immutability trigger/permissions, no hash/sequence chain, and nullable user references can lose display attribution. Evidence: `drizzle/schema.ts:80-91` and PostgreSQL migration `drizzle/postgres/0000_thick_psylocke.sql:9-18,157-171`.

8. **Medium — Sensitive operational data needs explicit access/redaction rules.** Admin order detail would expose customer phone/address and payment references; audit metadata currently stores order references and tracking numbers. The proposed admin UI should reveal contact/shipping only to admin users on order detail, redact payment secrets/provider payloads, and never display/store card data. Evidence: `drizzle/schema.ts:182-256`; `server/db.ts:1202-1211,1368-1378`.

## Recommended admin information architecture

Use `/admin` as a protected shell with a left navigation and URL-addressable sections. Every section should load through `adminProcedure` and show server-derived role/permissions, not client-selected scopes.

1. **Overview** (`/admin`): counts for products by status, low/out-of-stock, active/inactive stores, orders by status, pending/mismatched payments, and recent audit events. Counts must be aggregate queries with bounded time windows.
2. **Catalog & product intake** (`/admin/catalog`): searchable/filterable ledger of every `sellerProducts` row, including product ID, name, seller/store, status, price, inventory, image count/primary-image state, created/updated timestamps, and public-visibility reason. Detail drawer shows all `sellerProductImages` rows, provider IDs, format/dimensions, creator, order, and timestamps; never expose Cloudinary secrets. Filters: status, seller, category, inventory range, image completeness, created/updated date. “Taken into site” should mean a durable product creation event plus image asset events, not only currently published catalog rows.
3. **Orders** (`/admin/orders`): cursor-paginated order list with reference, date, customer, status, payment status, total, item count, seller count, and fulfillment summary. Detail shows order snapshot, item snapshots, seller/store, payment transaction, inventory reservation/release evidence, fulfillment/tracking, and a chronological audit timeline. Contact/address should be available only inside the protected detail view.
4. **Payments & reconciliation** (`/admin/payments`): pending queue plus historical transaction search by order/reference/provider ID/status/date; mismatch and provider-error states; last verification time; acting admin; and links to order/audit timeline. Keep the existing “verify with Paystack” mutation narrow and idempotent. Do not add manual “mark paid” or “mark failed” bypasses without a separately approved control and reason capture.
5. **Sellers & stores** (`/admin/sellers`): accounts, applications, store active state, product counts, paid-order counts, and recent seller/admin actions. Staff can retain seller review/intake; admin can see the same plus account audit history. Avoid duplicating staff mutations unless admin needs a distinct policy.
6. **People & roles** (`/admin/users`): cursor/search/filter by role/status/date, seller/store linkage, last sign-in, and role history. Keep grant/revoke staff as explicit buttons. If admin promotion/revocation is ever required, implement a separate two-person or owner-protected workflow; do not expose a role select.
7. **Audit log** (`/admin/audit`): append-only timeline with filters for date, actor, event type, target kind/id, order reference, product ID, seller, and request/correlation ID; detail view shows before/after JSON with redaction. Add CSV/JSON export only with bounded date range, server-side authorization, and an export audit event.
8. **Operations/settings** (`/admin/operations`): environment/provider readiness (Paystack/Cloudinary configured or disabled), migration/schema health, and documented feature flags. This should report configuration state without exposing secrets.

## Exact server/database additions

### 1. Add first-class audit targets and a durable product/site-intake ledger

Prefer a migration that extends `accountAuditEvents` (or introduces a generalized `auditEvents` table if a clean break is acceptable) with:

- `targetType` enum/text: `user | seller_application | store | product | product_image | order | order_item | payment | inventory | system`.
- `targetId` varchar/text nullable (the domain ID as text, allowing product IDs and numeric records).
- `orderId` integer nullable FK, `orderItemId` integer nullable FK, `productId` varchar nullable FK, `paymentTransactionId` integer nullable FK; these make filtering/joining reliable instead of parsing JSON metadata.
- `requestId`/`correlationId` varchar, `source` (`webhook | customer | seller | staff | admin | system`), and optional `before`/`after` JSON with a strict redaction helper.
- indexes on `(createdAt,id)`, `(eventType,createdAt,id)`, `(targetType,targetId,createdAt,id)`, `productId`, `orderId`, `actorUserId`, and `paymentTransactionId`.
- `createdAt` and a monotonically increasing ID remain server/database generated; no update/delete procedure.

If retaining `accountAuditEvents` for compatibility, add `auditEvents` and migrate/dual-write existing events, or add nullable columns plus a backfill convention. Add a database trigger denying UPDATE/DELETE for the application role (or grant INSERT/SELECT only on the audit table through a dedicated DB role). A hash-chain is optional but useful for tamper evidence; at minimum retain the event ID/time and provider/request correlation.

Add explicit event types for `product_created`, `product_updated`, `product_status_changed`, `product_inventory_changed`, `product_image_added`, `product_image_primary_changed`, `product_image_removed` (if removal is implemented), `order_inventory_reserved`, `order_inventory_released`, `order_status_changed`, `payment_reconciliation_attempted`, `payment_reconciliation_mismatch`, `payment_provider_error`, `admin_audit_exported`, and `admin_read_sensitive_order` if compliance requires read logging. Include product/order/payment IDs, old/new status or inventory, actor, source, and safe reason metadata.

### 2. Add admin query functions in `server/db.ts`

Implement bounded, cursor-based functions rather than unbounded `findMany` equivalents:

- `getAdminOverview({ since })`: aggregate product/order/payment/store counts and latest event summaries.
- `listProductsForAdmin({ cursor, limit, search, status, sellerUserId, category, inventory, imageState, from, to })`: join `sellerProducts` to `users`, `sellerStores`, and pre-aggregated image counts; return `nextCursor` based on `(updatedAt,id)`.
- `getProductForAdmin(productId)`: product, seller/store, all images, and product-target audit events.
- `listOrdersForAdmin({ cursor, limit, search, status, paymentStatus, sellerUserId, from, to })`: join orders/payment and item aggregate; cursor by `(createdAt,id)`.
- `getOrderForAdmin(reference or id)`: order/customer snapshot, items/seller/store, payment, and joined audit timeline. Redact provider payloads and restrict this function to admin procedure.
- `listPaymentsForAdmin({ cursor, status, reference, providerTransactionId, orderReference, from, to })`: all payment statuses and reconciliation fields, not only pending.
- `listSellersForAdmin(...)` and `getSellerForAdmin(userId)`: role, application, store, counts, and recent events.
- `listUsersForAdmin({ cursor, search, role, from, to })`: replace the hard limit of 200 with stable pagination.
- `listAuditEventsForAdmin({ cursor, actorUserId, targetType, targetId, eventType, productId, orderId, from, to })`: joins actor/target display fields and returns redacted metadata plus `nextCursor`.

All queries should select only fields needed by the UI, apply maximum limits (for example 100), validate filters with Zod, and use stable composite cursors. Avoid exposing `openId`, Clerk tokens, payment secrets, or raw provider response bodies.

### 3. Add admin routers while preserving authorization

In `server/routers.ts`, add `admin.overview`, `admin.products`, `admin.product`, `admin.orders`, `admin.order`, `admin.payments`, `admin.sellers`, `admin.users` (new paginated input), and `admin.audit`, all with `adminProcedure`. Keep `admin.reconcilePayment` as the only payment state mutation and extend it only to write an attempt/mismatch/provider-error event with `ctx.user.id` and a correlation ID. Add an explicit `admin.exportAudit` query/mutation only after the read view exists; it must enforce a max date range/row count and write `admin_audit_exported`.

Do not add client-provided `actorUserId`, `role`, seller ownership, or payment amount/status to any input. For product/admin write operations that are eventually approved, use a dedicated `admin` capability and transactionally lock/re-check the row. A read-only catalog audit does not require new mutations.

Correct `updateSellerOrderItemFulfillment` to accept `actorUserId` separately from `sellerUserId` and pass `ctx.user.id` from the router. Preserve seller ownership checks using `sellerUserId`; audit the requester as actor. Add regression tests covering seller actor and suspended-customer actor.

Instrument missing business events at the mutation boundary: seller product create/update, status transitions, inventory changes, every image persistence path, checkout reservation/release, order status changes, and payment reconciliation attempts. For multi-row checkout, write one order-level event plus per-product inventory deltas rather than relying on a generic account event.

### 4. Add tests and operational safeguards

Add authorization tests proving customer/seller/staff cannot call any new admin query; admin can only see fields permitted by the query; filters cannot escape tenant/row constraints; and cursors cannot be tampered with to broaden results. Add transaction tests for event/business-state atomicity and audit actor correctness. Add tests for redaction and export bounds. Keep existing migration runner discipline and add migration collision/fingerprint coverage as appropriate.

## Exact client additions

- Replace `AdminDashboardPage` in `client/src/pages/AccountPages.tsx:174-197` with an `AdminWorkspacePage` shell that uses tabs/links for Overview, Catalog, Orders, Payments, Sellers, Users, Audit, and Operations.
- Add `client/src/pages/AdminCatalogPage.tsx`, `AdminOrdersPage.tsx`, `AdminPaymentsPage.tsx`, `AdminSellersPage.tsx`, `AdminUsersPage.tsx`, and `AdminAuditPage.tsx` (or equivalent route components). Register nested `/admin/:section` paths in `client/src/App.tsx` while retaining the outer `/admin` server-gated entry.
- Use tRPC hooks for the new admin queries with `enabled: account.data?.role === "admin"` only as a request optimization; rely on `adminProcedure` for security. On `FORBIDDEN`/`UNAUTHORIZED`, render the existing access-denied state and do not show cached privileged data.
- Catalog UI: virtualized/cursor table, status/image/inventory filters, seller search, product detail drawer, image asset grid, and an event timeline. Clearly label legacy `external` images versus Cloudinary assets using the `format` and provider fields.
- Orders UI: list/detail split view, payment/fulfillment badges, item/seller grouping, customer-contact disclosure inside detail only, and a timeline linking to product/payment audit events.
- Payments UI: preserve the current pending queue action; add historical filters and reconciliation result/error states, not a direct state-edit button. Show “Paystack not configured” based on server readiness, not hard-coded assumptions.
- Audit UI: filter chips, date range, event detail with redacted before/after JSON, actor/target links, and bounded export. Show event IDs/timestamps and correlation IDs for support investigations.
- Users UI: replace the current unpaginated 200-row list with search/filter/pagination and role-history link. Keep explicit grant/revoke staff buttons and confirmation dialogs; never add a generic role dropdown.
- Add a visible “last refreshed” time, retry controls, loading/error/empty states, and stale-data warning for operational queues. Use accessible table headers, keyboard-safe detail dialogs, and no sensitive values in browser logs.

## Delivery order

1. Fix fulfillment actor attribution and add regression tests.
2. Add generalized/extended audit target columns, indexes, redaction helper, and append-only DB permissions.
3. Add event coverage for product/image/inventory/order/reconciliation mutations.
4. Add admin catalog, order, payment-history, and audit query functions with cursor pagination and tests.
5. Add the admin workspace routes and client sections, starting with Catalog and Audit because they satisfy the detailed product-log requirement.
6. Add seller/user/overview/operations sections and bounded audit export.
7. Configure Paystack test credentials and a controlled test account/listing, then run end-to-end reconciliation and verify that every state change appears in the admin timeline. Do not enable live payments or seller payouts until the existing business/compliance prerequisites in `TODO.md:31-34` are satisfied.

## Source index

- Routing/UI: `client/src/App.tsx:16-45`, `client/src/pages/AdminAccessPage.tsx:27-59`, `client/src/pages/AccountPages.tsx:165-197`.
- Server authorization/context: `server/_core/context.ts:18-60`, `server/_core/trpc.ts:17-50`, `server/_core/authorization.ts:12-78`.
- Admin/staff routers: `server/routers.ts:291-400`.
- Schema: `drizzle/schema.ts:39-91,125-180,182-256`.
- Database/admin/payment/product/order functions: `server/db.ts:132-210,539-577,643-723,758-835,952-1090,1112-1289,1291-1390`.
- Paystack classification: `server/payments/reconciliation.ts:1-17`.
- Deployment/test caveats and unconfigured providers: `TODO.md:17-33`, `plan.md:33-43`.
