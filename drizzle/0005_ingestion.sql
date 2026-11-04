CREATE TABLE "ingestion_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"decision" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"impact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_attempt_decision_check" CHECK ("ingestion_attempt"."decision" in ('deferred', 'published'))
);
--> statement-breakpoint
CREATE TABLE "ingestion_candidate" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_candidate_status_check" CHECK ("ingestion_candidate"."status" in ('pending', 'retry', 'published'))
);
--> statement-breakpoint
CREATE TABLE "ingestion_run" (
	"day" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"status" text NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"counts" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingestion_run_status_check" CHECK ("ingestion_run"."status" in ('running', 'completed', 'retry'))
);
--> statement-breakpoint
ALTER TABLE "ingestion_attempt" ADD CONSTRAINT "ingestion_attempt_candidate_id_ingestion_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."ingestion_candidate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_attempt" ADD CONSTRAINT "ingestion_attempt_impact_id_ai_impact_id_fk" FOREIGN KEY ("impact_id") REFERENCES "public"."ai_impact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_attempt_candidate_idx" ON "ingestion_attempt" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_attempt_success_unique" ON "ingestion_attempt" USING btree ("candidate_id","input_hash") WHERE "ingestion_attempt"."decision" = 'published';--> statement-breakpoint
CREATE INDEX "ingestion_candidate_retry_idx" ON "ingestion_candidate" USING btree ("status","next_attempt_at");