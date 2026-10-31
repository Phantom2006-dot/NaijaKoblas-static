# NaijaKoblas TODO

## Implemented and deployed

- Clerk is the sole end-user identity provider. Email/password, verified primary email, matching frontend/API keys and DB-owned customer/seller/staff/admin roles remain the authentication boundary.
- The ShabaAutos-inspired workflow code is on GitHub `main` at commit `eaea087` and included in READY Vercel production; Fly release v9 runs the matching API image. The standalone `/admin` entry, role-aware seller/staff workspaces, gallery/upload UI and notification bell are present. `/admin` is outside public storefront navigation and only administrators can see admin data.
- Sellers use one identity for shopping and approved store management. Staff/admin can create seller-owned drafts for approved active stores. Seller review, selected primary product image and available stock are required before publishing.
- Product photo uploads use an authenticated Cloudinary-only endpoint. It validates session, role, seller/store/product ownership before parsing and again at persistence; accepts JPEG/PNG/WebP with signature validation; limits a file to 8 MB, a batch to 4 files/32 MB and a listing to 10 images. One batch is allowed per API process; the slot remains reserved through parser cleanup and all upload/database/compensation work, even after client disconnect. Account uploads are limited to 12 batches/10 minutes per process. New listing APIs reject arbitrary remote image URLs; existing HTTPS image values are legacy-only format `external`.
- Notification inbox items are recipient-scoped, safe-local-link, idempotent records. Seller application/review, staff access, payment, fulfillment and staff intake events are written transactionally with their business state where implemented. UI polling is 45 seconds with read/mark-all, Escape/outside-close, focus return and keyboard disclosure behavior. No email/SMS/push delivery worker is implemented.
- The PostgreSQL gallery and notification migrations are now applied by Fly v9. The runner sets local `search_path` to `public`, fingerprints the existing baseline against DDL recreated in a scratch schema, validates an exact ordered journal prefix, preflights later objects/data targets, serializes with a transaction advisory lock and commits pending DDL/ledger rows atomically. Scratch cleanup is in a `finally` path. Its strict SQL parser rejects unsupported/commented or multi-command migration chunks, the `USING INDEX` suffix and unknown statement forms until explicit parser rules and tests are added. Package `db:migrate` and `db:push` route through the custom runner.
- The checked-in localhost-only migration harness covers fresh setup, exact baseline adoption/data preservation, enum/schema mismatch, sequence-owner mismatch, unledgered later schema, constraint-only and data-only targets, history gap, ambient `search_path` and concurrency. It creates/drops only its own random temporary databases.

## Current live deployment

- Vercel production includes feature/migration commit `eaea087`; its `/api/*` proxy reaches the upgraded Fly v9 API. Direct Fly and Vercel-proxied `/api/health` and `/api/auth/status` returned HTTP 200. The Clerk status is configured and the browser/API publishable keys match. `/login`, `/signup` and `/admin` return HTTP 200.
- Fly app `naijakoblas-static` is release v9/image `marketplace-eaea087`, with exactly one `shared-cpu-1x` 512 MB machine in Amsterdam on port 3000. The release migration command completed successfully and the Vercel-proxied gallery-aware catalog query returned HTTP 200 with an empty result. The machine was stopped after smoke tests; autostart/stop-on-idle remains enabled.
- Fly currently has `DATABASE_URL`, `APP_BASE_URL`, and the Clerk key pair. `DATABASE_URL_UNPOOLED` is absent; the runner used its pooled-URL fallback successfully. The upload route returned HTTP 401 without credentials before parsing; no `CLOUDINARY_*` values are present, so authenticated uploads still return a storage-setup response. `OWNER_CLERK_USER_ID` and Paystack keys are unset.
- The Neon test project now contains the approved baseline plus the gallery/notification migrations; no approved test seller/listing has been created. The old app `naijakoblas-api-test` still has an unused staged Neon secret; remove it only after confirming it is not needed.

## Validation and remaining risks

- Passing locally: `pnpm check`; `pnpm test` (17 files/85 tests); `pnpm build`; `pnpm build:static`; `git diff --check`; strict Fly configuration validation; Linux/AMD64 image build (74,842,796 bytes); nine localhost PostgreSQL migration scenarios; and two runs of `pnpm db:migrate` against a disposable local database. All successful migration paths ended with three ordered ledger rows.
- An independent audit found no high/medium code issues in the final migration runner, strict SQL parser or package migration wiring. The audit did not connect to Neon; the live release command itself completed successfully, and the gallery-aware public catalog query succeeded after release.
- No authenticated seller upload, Cloudinary persistence/cleanup, staff/admin draft workflow, owner bootstrap, Paystack transaction, refund or vendor payout has been exercised end to end. Live payment and seller payout remain disabled.
- Residual operational limits: the upload concurrency/rate limiter is process-local and must be shared if scaling beyond one API machine; no durable Cloudinary orphan reconciler or external notification worker exists.

## Next

1. Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` through Fly protected Secrets, then test upload, primary-photo selection, seller publish, staff/admin draft flow, public gallery, ownership denial and cleanup with a controlled approved seller/listing.
2. Register and verify the owner at `/signup`, obtain the exact Clerk ID from Clerk Dashboard, set `OWNER_CLERK_USER_ID` in Fly and verify first-admin bootstrap and `/admin` isolation. Do not share passwords or email codes.
3. Configure Paystack test credentials/webhook and test payment/inventory transitions. Keep live payments and vendor payouts disabled.
4. Remove the old app’s unused Neon secret only after confirming it is no longer needed. Define seller settlements and refunds before any split/payout implementation.
