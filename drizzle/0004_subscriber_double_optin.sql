CREATE TYPE "public"."subscriber_status" AS ENUM('pending', 'confirmed', 'unsubscribed');--> statement-breakpoint
CREATE TABLE "subscribe_throttle" (
	"scope" varchar(16) NOT NULL,
	"key_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "subscribe_throttle_scope_key_hash_window_start_pk" PRIMARY KEY("scope","key_hash","window_start"),
	CONSTRAINT "subscribe_throttle_scope_check" CHECK ("subscribe_throttle"."scope" in ('ip','email')),
	CONSTRAINT "subscribe_throttle_count_check" CHECK ("subscribe_throttle"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscriber" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"status" "subscriber_status" DEFAULT 'pending' NOT NULL,
	"confirm_token_hash" text,
	"confirm_token_expires_at" timestamp with time zone,
	"unsub_token_hash" text NOT NULL,
	"source" varchar(120) DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	CONSTRAINT "subscriber_email_normalized" CHECK ("subscriber"."email" = lower(btrim("subscriber"."email"))),
	CONSTRAINT "subscriber_email_format" CHECK ("subscriber"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
	CONSTRAINT "subscriber_confirm_token_pending_only" CHECK (case
            when "subscriber"."status" = 'pending'
              then "subscriber"."confirm_token_hash" is not null and "subscriber"."confirm_token_expires_at" is not null
            else "subscriber"."confirm_token_hash" is null and "subscriber"."confirm_token_expires_at" is null
          end),
	CONSTRAINT "subscriber_status_timestamps" CHECK (("subscriber"."status" <> 'confirmed' or "subscriber"."confirmed_at" is not null)
          and ("subscriber"."status" <> 'unsubscribed' or "subscriber"."unsubscribed_at" is not null))
);
--> statement-breakpoint
CREATE INDEX "subscribe_throttle_window_start_idx" ON "subscribe_throttle" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriber_email_unique" ON "subscriber" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriber_confirm_token_hash_unique" ON "subscriber" USING btree ("confirm_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriber_unsub_token_hash_unique" ON "subscriber" USING btree ("unsub_token_hash");--> statement-breakpoint
CREATE INDEX "subscriber_status_idx" ON "subscriber" USING btree ("status");