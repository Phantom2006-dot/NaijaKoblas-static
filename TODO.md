# NaijaKoblas TODO

## Implemented and deployed

- Clerk is the sole end-user identity provider. Email/password, verified primary email, matching frontend/API keys and database-owned customer/seller/staff/admin roles remain the authentication boundary. The application never stores password hashes.
- Feature code from GitHub commit `70eec80` is included in READY Vercel production. Fly release v11 runs image `ops-70eec80` on the existing `naijakoblas-static` app. `/admin` uses the same branded `/login` page as all accounts; only the server-returned Neon `admin` role opens admin tools.
- A verified ordinary customer can click “Become a seller” from `/account` or `/vendor` and receive seller access directly, without seller-specific personal/business details or staff approval. The server transaction creates/repairs the approved compatibility record, active store and seller role, and records audit/in-app notifications. Store details remain optional and can be updated later.
- Seller self-activation cannot replace staff/admin roles or bypass rejected, suspended, inactive-store, missing-store or incomplete seller records. Pending legacy records can be directly activated. The legacy form-submission API is hard-disabled; staff can still review historical records and retain seller suspension/reinstatement controls.
- Sellers keep one account for shopping and store management. Staff/admin can create seller-owned drafts for active seller stores. The seller must add/select a primary product photo, retain available stock and publish their own listing.
- Product photo uploads use an authenticated Cloudinary-only endpoint. It validates session, role and seller/store/product ownership before parsing and again at persistence; accepts JPEG/PNG/WebP with signature validation; limits a file to 8 MB, a batch to 4 files/32 MB and a listing to 10 images. One batch is allowed per API process; the slot remains reserved through parser cleanup and all upload/database/compensation work, even after client disconnect. Account uploads are limited to 12 batches/10 minutes per process. New listing APIs reject arbitrary remote image URLs; existing HTTPS image values are legacy-only format `external`.
- Notification inbox items are recipient-scoped, safe-local-link, idempotent records. Direct seller activation, legacy seller review/moderation, staff access, payment, fulfillment and staff intake events are written transactionally with business state where implemented. UI polling is 45 seconds with read/mark-all, Escape/outside-close, focus return and keyboard disclosure behavior. No email/SMS/push delivery worker is implemented.
- The PostgreSQL gallery and notification migrations are applied. The runner sets local `search_path` to `public`, fingerprints the existing baseline against DDL recreated in a scratch schema, validates an exact ordered journal prefix, preflights later objects/data targets, serializes with a transaction advisory lock and commits pending DDL/ledger rows atomically. Package `db:migrate` and `db:push` route through the custom runner.

## Current live deployment and configuration

- Vercel production for `naijakoblas-static` includes feature commit `70eec80e34905894a99dd153c97a7b207012b5e5` and is READY. The production `/`, `/login`, `/signup`, `/admin`, `/vendor` and `/account` routes returned HTTP 200; its `/api/*` proxy reaches Fly.
- Fly app `naijakoblas-static` is release v11/image `ops-70eec80`, with exactly one `shared-cpu-1x` 512 MB machine in Amsterdam on port 3000. Cloudinary credentials and the protected `OWNER_CLERK_USER_ID` are now configured through Fly Secrets; the Cloudinary connection was verified with a non-secret provider ping. Paystack remains unconfigured and seller payouts remain disabled.
- The first-admin bootstrap ID was configured from the user-supplied verified Clerk user ID. No password or verification code was created or shared.

## Completed role audit

- [x] Audited customer, seller, staff and admin flows, compared the local ShabaAutos operations patterns read-only, and researched role-aware navigation, product catalog administration, permissions and audit timelines.
- [x] Recorded detailed findings in the `audit-*.md` files and synthesized the implementation plan in `ROLE_WORKFLOW_AUDIT.md`.

## Phase 1 — role-aware storefront navigation

- [x] Replace unconditional `Become a Vendor` and `Get Started` header/footer links with one shared effective-role navigation policy.
- [x] Show active sellers `Seller Workspace`, staff `Staff Portal`, and administrators `Admin Portal`; keep sellers’ customer Account and shopping access visible.
- [x] Make anonymous and auth-loading states explicit so the navbar does not flash the wrong role or show Account as already available.
- [x] Apply the same role-aware behavior to homepage, About and vendor CTAs; reconcile all route manifests, including `/seller-fulfillment`.

## Phase 2 — protected admin catalog and audit workspace

- [x] Add admin-only overview counts and a searchable/cursor-paginated catalog ledger covering drafts, published, archived and out-of-stock products, seller/store ownership, image completeness and timestamps.
- [ ] Add protected product detail with gallery/provider metadata and product activity history; never expose provider secrets.
- [x] Add a readable admin audit timeline with actor, event, target, timestamp and redacted metadata.
- [ ] Keep admin staff-role controls explicit and protected; do not add a generic role dropdown or client-controlled actor identity.

## Phase 3 — operational records and admin sections

- [ ] Add first-class audit targets/indexes or a generalized append-only audit table, then instrument product/image/inventory/order/payment events.
- [ ] Add admin orders, payment history/reconciliation context, sellers/stores, paginated people and operations/provider-readiness sections.
- [ ] Correct fulfilment audit actor attribution so the authenticated requester—not merely the seller owner—is recorded.

## Phase 4 — staff and seller completeness

- [ ] Add staff listing moderation queues, structured safety/reinstatement cases and operational queue notifications while retaining server-side role boundaries.
- [ ] Add seller publish-readiness checklists, full product editing, image lifecycle controls, inventory visibility and more capable fulfilment operations.
- [ ] Keep self-service activation policy explicit: staff oversee safety and legacy records; they do not need to approve every newly activated seller.

## Still pending

- [ ] Verify Cloudinary uploads with a real seller listing after the corrected matching Cloudinary credentials; values remain provider-managed and are never stored in Git/chat.
- [ ] Configure and test Paystack test-mode credentials/webhook before end-to-end checkout reconciliation; seller payouts remain disabled.
- [ ] Exercise the protected first-admin bootstrap with the intended verified Clerk account and confirm the admin dashboard access.


## Phase 5 — mobile responsive visual pass
- [x] Make the public storefront usable at phone widths without horizontal scrolling: header actions, hero, trust strip, category controls, product cards, spotlight panel, forms, footer and fixed bottom navigation must fit the viewport and respect safe-area padding.
- [x] Replace conflicting mobile menu overrides with one full-screen contained drawer: clear open/close animation, backdrop, scroll lock, Escape/outside-close, focus return and touch-sized links must remain available for keyboard and touch users.
- [x] Add restrained 42-inspired editorial motion: section/content reveals and tap/hover feedback, with `prefers-reduced-motion` disabling non-essential movement and preserving readable content.
- [x] Stack account, seller, staff and admin rows/forms/tables safely on narrow screens while preserving actions, labels, overflow handling and protected workflows.
- [x] Validate the mobile build at representative narrow and tablet widths, then push and deploy only after TypeScript, tests, production/static builds and responsive smoke checks pass. Local phone/tablet screenshots, `pnpm check`, 94 tests, production/static builds and Vercel READY deployment for `a2113be` passed.

## November 2026 upgrade outcomes (current request)

- [ ] **Existing architecture and security preserved.** Inspect framework, APIs, database, storage, retrieval, reusable components and authorization. Work with existing code; do not rebuild Clerk or remove cart, checkout, wishlist, seller/staff/account, notifications, reconciliation or audit features. All new sensitive reads and writes are server-authorized; actor identity never comes from client input; inputs and errors are validated.
- [ ] **Real dashboard overview and analytics.** Total products/orders, verified paid revenue, pending/completed orders, low-stock listings, recent orders/products and sales charts derive from Postgres. No fake statistics or hardcoded business data; charts and metrics have labeled zero/loading/error states.
- [ ] **Fully functional admin product management.** View all statuses; add seller-owned drafts; edit name, description, price, category, stock and supported size/style variations; search by name; category/status/availability/stock filters; price/name/date sorting and pagination. Validated forms expose clear save/cancel/success/failure states. Changes persist in the existing product table and appear through the shared public catalog when the listing is eligible. Preserve seller ownership/publication safeguards and pending stock reservations.
- [ ] **Safe removal and media lifecycle.** Delete with confirmation and only where order foreign keys permit; keep order history intact and provide archive for historical records. Existing authenticated Cloudinary uploads retain provider/file/size/concurrency limits; preview chosen images, replace primary images and remove gallery entries safely. Never accept arbitrary new external media URLs or expose secrets. Report unverified live provider behavior accurately.
- [ ] **Order operations.** Browse/search/filter real customer orders, inspect customer/address, products/quantities, totals/payment status and tracking. Support Pending/Processing/Shipped/Delivered through the existing payment and item-fulfillment state model; cancellation/payment changes cannot bypass provider verification or invent a refund system. Preserve manual Paystack reconciliation and actor-aware audit records.
- [ ] **Customer records.** Search registered accounts, inspect relevant private customer/profile details and private order history under administrator-only access. No generic role selector or privilege escalation; retain explicit existing staff grant/revoke controls.
- [ ] **Professional responsive administration.** Sidebar sections for Overview, Products, Orders, Customers, Categories, Analytics, Settings and existing Audit/Operations functionality as applicable. Contextual title, current admin information, existing notifications and Clerk logout. Usable desktop/tablet/mobile navigation; visible keyboard focus, accessible dialogs, clear loading/empty/error states.
- [ ] **Improved Home and Products.** Preserve branding and photography while improving hero, headlines, CTAs, categories, featured live listings, story, navigation/footer, spacing and hierarchy. Product cards have consistent images, descriptions/prices, responsive grid, category/search/sort controls and loading/empty states. Public product data comes from the same product tables; existing purchase flows continue.
- [ ] **Improved About.** Preserve the Nigerian leather-goods/artisan mission, make story/values/layout more engaging and readable, and remove unsupported business promises rather than adding generic filler.
- [ ] **Real, usable Contact.** Present contact information honestly; validate all fields; store successful messages in the database and expose a protected admin inbox with success/error states. Preserve the support email, do not pretend an email was sent, and avoid unverified placeholder phone/WhatsApp or guaranteed response-time promises. Mobile contact forms remain usable.
- [ ] **Existing newsletter/waitlist no longer fake.** Preserve subscription controls but use a real durable validated backend submission with honest stored-for-review success and explicit errors; do not claim campaigns, email delivery or consent workflows beyond what is implemented.
- [ ] **Consistent polish/accessibility/performance.** Modern reusable buttons, cards, spacing, typography and palette; tasteful hover/modal/loading transitions; reduced-motion support; loading skeletons; no unnecessary dependencies, route changes, major console/type/build errors or performance regressions. Keep good public page metadata/SEO.
- [ ] **Verified phased delivery.** Confirm baseline first, verify backend contracts before admin UI, verify admin before public improvements, fix confirmed issues before advancing. Prove create/edit/public reflection/delete/history/image selection/order boundaries with a disposable localhost database and preserve existing automated tests. Clearly separate local proof from live-account/provider tests not performed.
- [ ] **Documented review handoff.** Summarize changed features, backend/schema changes, dependencies, missing features/reasons, environment variables and deployment steps. Provide a verified GitHub review branch/pull request, without automatically mutating production or enabling live payments.
