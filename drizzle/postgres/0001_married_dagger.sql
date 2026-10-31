CREATE TABLE "sellerProductImages" (
	"id" serial PRIMARY KEY NOT NULL,
	"productId" varchar(64) NOT NULL,
	"createdByUserId" integer,
	"url" text NOT NULL,
	"publicId" varchar(255),
	"assetId" varchar(64),
	"width" integer,
	"height" integer,
	"format" varchar(16) NOT NULL,
	"caption" varchar(240),
	"displayOrder" integer DEFAULT 0 NOT NULL,
	"isPrimary" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sellerProductImages_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "sellerProductImages_nonnegative_order" CHECK ("sellerProductImages"."displayOrder" >= 0),
	CONSTRAINT "sellerProductImages_positive_dimensions" CHECK (("sellerProductImages"."width" IS NULL OR "sellerProductImages"."width" > 0) AND ("sellerProductImages"."height" IS NULL OR "sellerProductImages"."height" > 0))
);
--> statement-breakpoint
CREATE TABLE "userNotifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipientUserId" integer NOT NULL,
	"eventKey" varchar(200) NOT NULL,
	"category" varchar(48) NOT NULL,
	"title" varchar(180) NOT NULL,
	"message" text NOT NULL,
	"href" varchar(512) NOT NULL,
	"readAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sellerProductImages" ADD CONSTRAINT "sellerProductImages_productId_sellerProducts_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."sellerProducts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellerProductImages" ADD CONSTRAINT "sellerProductImages_createdByUserId_users_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "userNotifications" ADD CONSTRAINT "userNotifications_recipientUserId_users_id_fk" FOREIGN KEY ("recipientUserId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sellerProductImages_product_order_idx" ON "sellerProductImages" USING btree ("productId","displayOrder");--> statement-breakpoint
CREATE UNIQUE INDEX "sellerProductImages_product_primary_unique" ON "sellerProductImages" USING btree ("productId") WHERE "sellerProductImages"."isPrimary" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "userNotifications_recipient_event_unique" ON "userNotifications" USING btree ("recipientUserId","eventKey");--> statement-breakpoint
CREATE INDEX "userNotifications_recipient_createdAt_idx" ON "userNotifications" USING btree ("recipientUserId","createdAt");--> statement-breakpoint
CREATE INDEX "userNotifications_recipient_unread_idx" ON "userNotifications" USING btree ("recipientUserId","createdAt") WHERE "userNotifications"."readAt" IS NULL;--> statement-breakpoint
INSERT INTO "sellerProductImages" ("productId", "url", "format", "displayOrder", "isPrimary", "createdAt")
SELECT "id", "imageUrl", 'external', 0, true, "createdAt"
FROM "sellerProducts"
WHERE "imageUrl" IS NOT NULL AND "imageUrl" LIKE 'https://%';
