CREATE TYPE "public"."correction_kind" AS ENUM('factual_error', 'source_problem', 'attribution_dispute', 'counter_evidence', 'situation_changed', 'other');--> statement-breakpoint
CREATE TYPE "public"."correction_status" AS ENUM('pending', 'corrected', 'confidence_lowered', 'counter_evidence_added', 'record_removed', 'declined');--> statement-breakpoint
CREATE TABLE "correction_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_ref" varchar(200),
	"kind" "correction_kind" NOT NULL,
	"body" text NOT NULL,
	"source_url" text,
	"source_quote" text,
	"email" text,
	"status" "correction_status" DEFAULT 'pending' NOT NULL,
	"source" varchar(120) DEFAULT 'unknown' NOT NULL,
	"ip_hash" text,
	"dedupe_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "correction_request_body_length" CHECK (char_length(btrim("correction_request"."body")) between 20 and 5000),
	CONSTRAINT "correction_request_source_url_format" CHECK ("correction_request"."source_url" is null or "correction_request"."source_url" ~ '^https?://'),
	CONSTRAINT "correction_request_source_quote_length" CHECK ("correction_request"."source_quote" is null or char_length("correction_request"."source_quote") between 20 and 2000),
	CONSTRAINT "correction_request_quote_needs_url" CHECK ("correction_request"."source_quote" is null or "correction_request"."source_url" is not null),
	CONSTRAINT "correction_request_email_normalized" CHECK ("correction_request"."email" is null or "correction_request"."email" = lower(btrim("correction_request"."email"))),
	CONSTRAINT "correction_request_email_format" CHECK ("correction_request"."email" is null
          or "correction_request"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
	CONSTRAINT "correction_request_resolved_at_matches_status" CHECK (("correction_request"."status" = 'pending') = ("correction_request"."resolved_at" is null))
);
--> statement-breakpoint
CREATE INDEX "correction_request_status_created_idx" ON "correction_request" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "correction_request_record_ref_idx" ON "correction_request" USING btree ("record_ref");--> statement-breakpoint
CREATE INDEX "correction_request_dedupe_hash_idx" ON "correction_request" USING btree ("dedupe_hash");