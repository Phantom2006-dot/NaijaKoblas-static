# NaijaKoblas implementation plan

## Storefront and runtime boundary

Keep the existing React storefront and Express/tRPC backend. Vercel serves the static Vite build at `https://naijakoblas-static.vercel.app`; its `/api/*` rewrite forwards API and Paystack webhook requests to `https://naijakoblas-static.fly.dev` before the SPA fallback. This same-origin boundary keeps browser requests and Clerk token-bearing tRPC calls on the storefront origin. Production is a public test deployment; Vercel previews remain protected.

Fly runs the API in Amsterdam on one `shared-cpu-1x` 512 MB machine, listening on port 3000. HTTPS health checks, autostart and stop-on-idle are configured, with a free shared IPv4. The API provides `/api/health`, public catalog and tRPC procedures. The empty Neon-backed catalog has returned HTTP 200. Fly meters compute while a machine runs; auto-stop reduces idle compute use.

## Clerk-only email/password authentication

Clerk replaces Manus OAuth as the sole end-user authentication provider. Use Clerk’s supported React SDK (`@clerk/react`) for the application provider and sign-in/sign-up components; its configured email/password strategy supplies email verification and password recovery. Do not build a second local password table, capture password values in NaijaKoblas forms, or store password hashes. The browser gets only `VITE_CLERK_PUBLISHABLE_KEY`; the server gets `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.

The React tRPC client obtains the Clerk session JWT and sends it as a Bearer token. Express validates a complete server key pair and a valid exact `APP_BASE_URL` origin before installing Clerk middleware, and always supplies that origin as the middleware’s `authorizedParties`. Production origins must use HTTPS; a partial key pair, enabled Clerk without an origin, or malformed/non-HTTPS production origin fails startup rather than skipping audience validation. When both server keys are absent, the public storefront and health endpoint remain available but account access is disabled.

The browser checks an uncached public auth-status endpoint before mounting `ClerkProvider`. It enables Clerk only when `VITE_CLERK_PUBLISHABLE_KEY` exactly matches the server’s public key and the server confirms a complete auth configuration. No secret is included in that response. Provider-dependent hooks are isolated behind a safe runtime context; the sign-in UI displays a setup state when either side is missing or mismatched.

For each authenticated API request, server context fetches the authoritative Clerk profile and requires its current primary email to be verified before looking up or synchronizing an application account. Unverified identities receive a clear `PRECONDITION_FAILED` response and cannot reach the one-time owner bootstrap. The physical legacy `openId` column stores the Clerk user ID to avoid a data-schema migration; application roles remain in Neon and are never accepted from the browser or Clerk profile claims.

Create/select a Clerk test application, enable email/password, require email verification, enable Clerk password recovery and allow the Vercel origin before adding keys. These keys are not yet configured, so sign-in is still unverified. After the owner signs up, set the exact `user_…` value as `OWNER_CLERK_USER_ID`; the transactional first-admin bootstrap is permitted only for that configured customer, once, and only before another admin exists. Do not guess or expose the value.

## Application roles and ownership

Customers begin with role `customer`. Sellers submit an application; staff/admin review it. Approved sellers receive seller capabilities; suspension removes catalog controls but leaves a narrow, owner-scoped ability to fulfill already-paid items. Administrators and staff can access only protected review/operations routes. All procedures derive owner IDs from the authenticated Clerk-to-Neon account mapping, not caller input. Audited role and payment reconciliation changes are persisted.

## Neon/Postgres and migrations

The app uses Drizzle ORM with `pg.Pool` and Neon. Runtime reads pooled `DATABASE_URL`; Drizzle Kit prefers direct `DATABASE_URL_UNPOOLED`. PostgreSQL migrations live in `drizzle/postgres/`; historical MySQL migrations are legacy and must not be applied to Neon. The user-approved baseline is applied to the new, empty London Free-plan test project. The pooled URL is set privately on Fly. No production DB was changed and no legacy MySQL rows were copied; any future preservation requires a separately validated export/transform/import.

## Customer commerce and seller operations

The public catalog exposes only published, in-stock products from active stores. Checkout sends product IDs, quantities, sizes, delivery details and a customer-scoped idempotency key—not client prices or totals. The server locks product/store rows, reserves inventory transactionally, binds the key to a canonical request, snapshots seller ownership and computes totals in integer kobo. The customer account shows private order history and resumable pending payment links. Seller dashboards manage owned listings/stock and per-item order fulfillment; customer contact details appear only for paid order fulfillment. Manual admin payment reconciliation verifies provider status and records the acting administrator.

## Paystack and vendor settlement

Paystack remains the planned Nigeria-focused hosted-checkout provider; its test credentials are not configured. The server initializes transactions from persisted order totals, and both raw-body signed webhooks and server-side verification require a matching reference, amount and NGN currency before marking an order paid. Verified failed, abandoned or reversed transactions release stock only while payment remains pending; ambiguous timeouts stay reserved for reconciliation.

The current integration pays into the marketplace Paystack account only. Seller subaccounts/multi-split, commissions, automatic payouts, refunds/returns and settlement policy are not implemented. Before vendor money is routed, define commission/fee rules, verify sellers’ bank identities, agree refund/chargeback and reconciliation handling, and confirm actual Paystack merchant enablement. Keep live commerce disabled.

## Deployment and remaining work

The live test frontend is Vercel and the API is Fly; `APP_BASE_URL` already points to the exact Vercel origin. Fly auto-starts the app when API traffic arrives and stops it when idle. Clerk and Paystack credentials/configuration remain missing, so sign-in, owner-admin bootstrap and test checkout are not yet verified. A prior generated `MANUS_JWT_SECRET` is unused by the new code and can be removed after deployment verification; the old `naijakoblas-api-test` app still has an unused staged database secret.

Next finish the production/static builds, deploy the reviewed commit to Vercel and the API image to the existing Fly app, then configure a Clerk test application with a matching publishable key on Vercel and Fly plus a secret key on Fly. Verify required email verification, login/logout, password recovery, account sync and server role checks through the Vercel origin. Configure the exact owner Clerk user ID after sign-up and verify the one-time admin bootstrap. Add Paystack test credentials/webhook and exercise the complete payment path. Before public launch, implement scheduled reconciliation/escalation, refunds/returns/support, customer notifications, image storage, carrier support, seller accounting and eligible vendor settlement.
