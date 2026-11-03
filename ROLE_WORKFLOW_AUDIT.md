# NaijaKoblas Role Workflow Audit and Improvement Plan

## What the audit found

NaijaKoblas already has the correct four-role foundation: customer, seller, staff and admin. The database role is authoritative, Clerk supplies identity, and server procedures protect seller, staff and admin data. The main problem is not authentication; it is information architecture and incomplete operations tooling.

The storefront navbar is currently role-blind. It always renders `Become a Vendor` and `Get Started`, then appends seller or staff links. An active seller therefore sees acquisition links that no longer apply. The footer repeats the same problem. The correct fix is one shared, server-derived navigation policy reused by the header, footer, homepage seller CTA and vendor page. A seller should retain customer shopping and account access, but see `Seller Workspace` instead of `Become a Seller`. Staff should see `Staff Portal`; admin should see `Admin Portal`; anonymous visitors should see `Sign In` and public shopping links.

The seller workspace is secure but incomplete. Publishing is correctly gated by active store, positive stock and a primary image, but the UI communicates only part of the reason a listing is blocked. Seller product editing is limited to price and stock, image lifecycle controls are incomplete, and inactive-store behavior is inconsistent. These should be improved after the navigation fix, without weakening server-side ownership or moderation controls.

The staff workspace currently combines legacy seller-record decisions with staff product intake. It lacks a product review queue, product history, structured moderation cases, and a staff activity queue. Seller self-activation is intentional, so staff should be described as responsible for safety oversight, legacy records, intake support, suspension and reinstatement—not routine approval of every new seller.

The admin workspace is the largest gap. It currently provides users, pending Paystack reconciliation and a staff intake panel, but no product ledger, product-image detail, seller/store overview, order detail, payment history, or readable audit log. The existing `accountAuditEvents` data should become queryable through an admin-only timeline, and future product/order/image/payment mutations should write first-class target metadata.

## Role model

- **Customer:** browse, shop, manage account and orders, and activate seller access directly when eligible.
- **Seller:** retain customer access plus an ownership-scoped seller workspace for store profile, listings, images, stock and paid-order fulfilment. Seller publishing remains seller-controlled.
- **Staff:** operate seller safety and marketplace operations: legacy seller records, seller oversight, staff-assisted draft intake, product review/case queues and suspension/reinstatement workflows. Staff do not manage roles, payment reconciliation or global settings.
- **Admin:** oversee the whole system: catalog and product intake logs, sellers/stores, orders, payment exceptions, users/staff access, audit history and provider readiness. Admin may open staff operations for coverage, but staff tools should be visibly separated.

Every server mutation must continue deriving the actor from the authenticated context. Client role labels are navigation hints only, never authorization.

## Target navigation

The public shell keeps topic/task navigation first: Home, Products, Why Koblas and Contact. The utility area changes from the resolved account state:

- Anonymous or resolving: public links, `Sign In`, cart; no misleading Account or seller acquisition link during auth loading.
- Customer: Account, cart, and one explicit `Become a Seller` entry point. Remove or rename ambiguous `Get Started` to `Join the Waitlist` if the waitlist remains active.
- Active seller: Seller Workspace, Account, cart. Remove `Become a Vendor` and `Get Started`.
- Restricted/incomplete seller: Account plus a clear access/support state; suspended sellers may see fulfilment-only access where allowed.
- Staff: Staff Portal, Account, cart. No seller self-service CTA.
- Admin: Admin Portal, Account, cart. Keep admin out of public marketing navigation.

Use the same policy in the header, footer and public seller CTAs. Sellers should always be able to switch back to shopping and customer orders.

## Admin operations structure

Use `/admin` as a protected operations shell with URL-addressable sections:

1. **Overview:** bounded counts for products, stores, orders, payments and recent activity.
2. **Catalog:** every product, not only published products, with seller/store, status, stock, image completeness, timestamps and public-visibility reason. Product detail includes gallery assets and product activity.
3. **Orders:** cursor-paginated order list and protected detail view with item/seller/fulfilment/payment timeline.
4. **Payments:** pending reconciliation plus historical status/search; preserve the narrow Paystack verification mutation and never add a manual mark-paid bypass.
5. **Sellers:** seller/store status, product and order counts, recent safety actions.
6. **People:** searchable/paginated accounts and explicit staff grant/revoke actions. Do not add a generic role dropdown or self-service admin promotion.
7. **Audit:** append-only, filterable event timeline with actor, target, event type, timestamp, safe metadata and bounded export later.
8. **Operations:** provider readiness and migration/health status without exposing secrets.

This follows established ecommerce patterns: Shopify documents a view-only store activity log plus per-resource timelines, and separates product, inventory, order and finance permissions. Shopify’s product section also treats title, media, pricing and inventory as a coherent catalog record, while order administration centers on order detail and fulfilment. Nielsen Norman Group cautions that role-based navigation should be used only when a role has genuinely unique content, with plain labels and easy switching. Sources: [1] [2] [3] [4] [5].

## Build order

### Phase 1 — navigation and role clarity

Create a shared effective-role/navigation selector, refactor header/footer/homepage/vendor CTAs, make anonymous Account behavior explicit, add staff/admin links without seller leakage, and reconcile route manifests.

### Phase 2 — admin catalog and audit visibility

Add bounded admin catalog queries and product detail queries, expose gallery/image provenance, add the protected admin workspace shell and catalog/audit sections, then add tests for customer/seller/staff denial and admin-only access.

### Phase 3 — operational records

Add first-class audit target fields or a generalized audit table, instrument product/image/inventory/order/payment events, add orders/payments/sellers/admin-user views, and fix fulfillment actor attribution.

### Phase 4 — staff operations and seller completeness

Add staff listing queues and structured safety cases, improve seller publish readiness checklists and product editing, then add image lifecycle and inventory/fulfilment improvements without relaxing ownership or suspension boundaries.

## Delivery workflow

Work against the existing `main` branch and existing Fly app. Run typecheck, tests, API build, static build and whitespace checks after each phase. Push one reviewed commit at a time; Vercel will build the frontend, and Fly must receive a new API image whenever routers, database functions or migrations change. Keep the single Fly machine and stop it after smoke checks. Do not enable live Paystack settlement or expose Cloudinary/provider secrets.

## References

[1]: https://www.nngroup.com/articles/audience-based-navigation/ "Nielsen Norman Group: Audience-Based Navigation"
[2]: https://help.shopify.com/en/manual/shopify-admin/activity-logs "Shopify: Activity logs in the Shopify admin"
[3]: https://help.shopify.com/en/manual/your-account/users/roles/permissions/store-permissions "Shopify: Store permissions"
[4]: https://help.shopify.com/en/manual/products "Shopify: Products"
[5]: https://help.shopify.com/en/manual/orders "Shopify: Order management and fulfillment"
