CREATE TYPE "public"."account_role" AS ENUM('customer', 'seller', 'staff', 'admin');--> statement-breakpoint
CREATE TYPE "public"."delivery_method" AS ENUM('standard', 'express');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'paid', 'payment_failed', 'cancelled', 'fulfilled');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('paystack');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."seller_application_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TABLE "accountAuditEvents" (
	"id" serial PRIMARY KEY NOT NULL,
	"actorUserId" integer,
	"targetUserId" integer,
	"eventType" varchar(96) NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adminBootstrap" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customerProfiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"firstName" varchar(100) NOT NULL,
	"lastName" varchar(100) NOT NULL,
	"email" varchar(320) NOT NULL,
	"phone" varchar(40) NOT NULL,
	"address" varchar(300) NOT NULL,
	"city" varchar(100) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orderItems" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderId" integer NOT NULL,
	"productId" varchar(64),
	"sellerUserId" integer,
	"nameSnapshot" varchar(180) NOT NULL,
	"makerSnapshot" varchar(160) NOT NULL,
	"unitPriceKobo" integer NOT NULL,
	"quantity" integer NOT NULL,
	"size" varchar(40) NOT NULL,
	"lineTotalKobo" integer NOT NULL,
	CONSTRAINT "orderItems_total_consistent" CHECK ("orderItems"."unitPriceKobo" > 0 AND "orderItems"."quantity" > 0 AND "orderItems"."lineTotalKobo" = "orderItems"."unitPriceKobo" * "orderItems"."quantity")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" varchar(64) NOT NULL,
	"customerUserId" integer NOT NULL,
	"idempotencyKey" varchar(64) NOT NULL,
	"status" "order_status" DEFAULT 'pending_payment' NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"firstName" varchar(100) NOT NULL,
	"lastName" varchar(100) NOT NULL,
	"email" varchar(320) NOT NULL,
	"phone" varchar(40) NOT NULL,
	"address" varchar(300) NOT NULL,
	"city" varchar(100) NOT NULL,
	"deliveryMethod" "delivery_method" NOT NULL,
	"subtotalKobo" integer NOT NULL,
	"shippingKobo" integer NOT NULL,
	"totalKobo" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_reference_unique" UNIQUE("reference"),
	CONSTRAINT "orders_totals_consistent" CHECK ("orders"."subtotalKobo" >= 0 AND "orders"."shippingKobo" >= 0 AND "orders"."totalKobo" = "orders"."subtotalKobo" + "orders"."shippingKobo")
);
--> statement-breakpoint
CREATE TABLE "paymentTransactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderId" integer NOT NULL,
	"provider" "payment_provider" DEFAULT 'paystack' NOT NULL,
	"reference" varchar(64) NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amountKobo" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"checkoutUrl" text,
	"providerTransactionId" varchar(64),
	"verifiedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paymentTransactions_reference_unique" UNIQUE("reference"),
	CONSTRAINT "paymentTransactions_positive_amount" CHECK ("paymentTransactions"."amountKobo" > 0)
);
--> statement-breakpoint
CREATE TABLE "sellerApplications" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"legalName" varchar(160) NOT NULL,
	"email" varchar(320) NOT NULL,
	"businessName" varchar(160) NOT NULL,
	"craftSummary" text NOT NULL,
	"phone" varchar(40) NOT NULL,
	"city" varchar(100) NOT NULL,
	"status" "seller_application_status" DEFAULT 'pending' NOT NULL,
	"reviewNote" text,
	"reviewedByUserId" integer,
	"reviewedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sellerProducts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"sellerUserId" integer NOT NULL,
	"name" varchar(180) NOT NULL,
	"description" text NOT NULL,
	"category" varchar(80) NOT NULL,
	"priceKobo" integer NOT NULL,
	"imageUrl" text,
	"sizes" jsonb NOT NULL,
	"inventoryCount" integer DEFAULT 0 NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sellerProducts_positive_price" CHECK ("sellerProducts"."priceKobo" > 0),
	CONSTRAINT "sellerProducts_nonnegative_inventory" CHECK ("sellerProducts"."inventoryCount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sellerStores" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"displayName" varchar(160) NOT NULL,
	"city" varchar(100) NOT NULL,
	"description" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(255) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "account_role" DEFAULT 'customer' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
ALTER TABLE "accountAuditEvents" ADD CONSTRAINT "accountAuditEvents_actorUserId_users_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accountAuditEvents" ADD CONSTRAINT "accountAuditEvents_targetUserId_users_id_fk" FOREIGN KEY ("targetUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adminBootstrap" ADD CONSTRAINT "adminBootstrap_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customerProfiles" ADD CONSTRAINT "customerProfiles_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orderItems" ADD CONSTRAINT "orderItems_orderId_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orderItems" ADD CONSTRAINT "orderItems_productId_sellerProducts_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."sellerProducts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orderItems" ADD CONSTRAINT "orderItems_sellerUserId_users_id_fk" FOREIGN KEY ("sellerUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerUserId_users_id_fk" FOREIGN KEY ("customerUserId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paymentTransactions" ADD CONSTRAINT "paymentTransactions_orderId_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellerApplications" ADD CONSTRAINT "sellerApplications_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellerApplications" ADD CONSTRAINT "sellerApplications_reviewedByUserId_users_id_fk" FOREIGN KEY ("reviewedByUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellerProducts" ADD CONSTRAINT "sellerProducts_sellerUserId_users_id_fk" FOREIGN KEY ("sellerUserId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellerStores" ADD CONSTRAINT "sellerStores_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accountAuditEvents_target_createdAt_idx" ON "accountAuditEvents" USING btree ("targetUserId","createdAt");--> statement-breakpoint
CREATE INDEX "accountAuditEvents_actor_createdAt_idx" ON "accountAuditEvents" USING btree ("actorUserId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "customerProfiles_userId_unique" ON "customerProfiles" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "orderItems_order_idx" ON "orderItems" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "orderItems_seller_order_idx" ON "orderItems" USING btree ("sellerUserId","orderId");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_customer_idempotency_unique" ON "orders" USING btree ("customerUserId","idempotencyKey");--> statement-breakpoint
CREATE INDEX "orders_customer_createdAt_idx" ON "orders" USING btree ("customerUserId","createdAt");--> statement-breakpoint
CREATE INDEX "orders_status_createdAt_idx" ON "orders" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "paymentTransactions_order_idx" ON "paymentTransactions" USING btree ("orderId");--> statement-breakpoint
CREATE UNIQUE INDEX "sellerApplications_userId_unique" ON "sellerApplications" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "sellerApplications_status_updatedAt_idx" ON "sellerApplications" USING btree ("status","updatedAt");--> statement-breakpoint
CREATE INDEX "sellerApplications_reviewer_idx" ON "sellerApplications" USING btree ("reviewedByUserId");--> statement-breakpoint
CREATE INDEX "sellerProducts_seller_createdAt_idx" ON "sellerProducts" USING btree ("sellerUserId","createdAt");--> statement-breakpoint
CREATE INDEX "sellerProducts_status_category_idx" ON "sellerProducts" USING btree ("status","category");--> statement-breakpoint
CREATE UNIQUE INDEX "sellerStores_userId_unique" ON "sellerStores" USING btree ("userId");