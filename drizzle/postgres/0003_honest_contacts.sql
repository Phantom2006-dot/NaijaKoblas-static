CREATE TYPE "public"."contact_message_status" AS ENUM ('new', 'in_progress', 'resolved');
--> statement-breakpoint
CREATE TABLE "contactMessages" (
  "id" serial PRIMARY KEY NOT NULL,
  "firstName" varchar(100) NOT NULL,
  "lastName" varchar(100) NOT NULL,
  "email" varchar(320) NOT NULL,
  "subject" varchar(180) NOT NULL,
  "message" text NOT NULL,
  "status" "contact_message_status" DEFAULT 'new' NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletterSubscriptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" varchar(320) NOT NULL,
  "source" varchar(32) DEFAULT 'newsletter' NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "contactMessages_status_createdAt_idx" ON "contactMessages" USING btree ("status", "createdAt");
--> statement-breakpoint
CREATE INDEX "contactMessages_email_createdAt_idx" ON "contactMessages" USING btree ("email", "createdAt");
--> statement-breakpoint
CREATE UNIQUE INDEX "newsletterSubscriptions_email_unique" ON "newsletterSubscriptions" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "newsletterSubscriptions_createdAt_idx" ON "newsletterSubscriptions" USING btree ("createdAt");
