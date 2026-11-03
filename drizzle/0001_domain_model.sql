CREATE TYPE "public"."attribution_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."company_size" AS ENUM('micro', 'small', 'medium', 'large', 'enterprise', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."impact_type" AS ENUM('replaced_by_ai_product', 'ai_cost_cutting_layoff', 'voluntary_pivot', 'mentioned_in_coverage');--> statement-breakpoint
CREATE TYPE "public"."industry" AS ENUM('education', 'media_publishing', 'software_saas', 'it_services', 'customer_service_bpo', 'translation_localization', 'design_creative', 'data_annotation', 'marketing_advertising', 'ecommerce_retail', 'finance_insurance', 'healthcare', 'manufacturing', 'logistics_transport', 'telecom', 'legal', 'recruitment_hr', 'gaming_entertainment', 'travel_hospitality', 'food_beverage', 'other');--> statement-breakpoint
CREATE TYPE "public"."link_health" AS ENUM('ok', 'bot_blocked', 'unreachable', 'dead');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('shutdown', 'bankruptcy', 'mass_layoff', 'downsizing_announced', 'pivot', 'acquired', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('draft', 'in_review', 'published', 'rejected', 'archived');--> statement-breakpoint
CREATE TYPE "public"."region" AS ENUM('north_america', 'latin_america', 'europe', 'middle_east_africa', 'asia_pacific', 'global');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('primary_company', 'tier1_media', 'trade_media', 'research', 'aggregator', 'other');--> statement-breakpoint
CREATE TABLE "ai_impact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"impact_type" "impact_type" NOT NULL,
	"attribution_confidence" "attribution_confidence" NOT NULL,
	"outcome" "outcome" NOT NULL,
	"event_date" date NOT NULL,
	"event_date_precision" varchar(5) DEFAULT 'day' NOT NULL,
	"summary" text NOT NULL,
	"summary_en" text,
	"employees_affected" integer,
	"employees_affected_pct" numeric(5, 2),
	"revenue_impact_note" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"counter_evidence" text,
	"record_status" "record_status" DEFAULT 'draft' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_impact_event_date_precision_check" CHECK ("ai_impact"."event_date_precision" in ('day','month','year')),
	CONSTRAINT "ai_impact_employees_affected_check" CHECK ("ai_impact"."employees_affected" is null or "ai_impact"."employees_affected" >= 0),
	CONSTRAINT "ai_impact_employees_affected_pct_check" CHECK ("ai_impact"."employees_affected_pct" is null or ("ai_impact"."employees_affected_pct" >= 0 and "ai_impact"."employees_affected_pct" <= 100)),
	CONSTRAINT "ai_impact_summary_length_check" CHECK (char_length("ai_impact"."summary") between 30 and 800)
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" varchar(200) NOT NULL,
	"name_zh" varchar(200),
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"country_code" char(2) NOT NULL,
	"region" "region" NOT NULL,
	"industry" "industry" NOT NULL,
	"company_size" "company_size" DEFAULT 'unknown' NOT NULL,
	"founded_year" smallint,
	"website_url" text,
	"description" text,
	"logo_url" text,
	"record_status" "record_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_slug_format" CHECK ("company"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "company_country_code_format" CHECK ("company"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "company_founded_year_range" CHECK ("company"."founded_year" is null or ("company"."founded_year" >= 1800 and "company"."founded_year" <= 2100))
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_impact_id" uuid NOT NULL,
	"url" text NOT NULL,
	"media_name" varchar(160) NOT NULL,
	"source_type" "source_type" NOT NULL,
	"published_at" date NOT NULL,
	"title" text,
	"author" varchar(200),
	"quote" text NOT NULL,
	"quote_lang" char(2) DEFAULT 'en' NOT NULL,
	"quote_translation_zh" text,
	"archive_url" text,
	"http_status" smallint,
	"link_health" "link_health" DEFAULT 'ok' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"manually_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_url_format" CHECK ("source"."url" ~ '^https?://'),
	CONSTRAINT "source_quote_length_check" CHECK (char_length("source"."quote") between 20 and 2000),
	CONSTRAINT "source_media_name_not_blank" CHECK (btrim("source"."media_name") <> ''),
	CONSTRAINT "source_quote_lang_format" CHECK ("source"."quote_lang" ~ '^[a-z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "ai_impact" ADD CONSTRAINT "ai_impact_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_impact" ADD CONSTRAINT "ai_impact_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_ai_impact_id_ai_impact_id_fk" FOREIGN KEY ("ai_impact_id") REFERENCES "public"."ai_impact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_impact_company_id_idx" ON "ai_impact" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ai_impact_event_date_idx" ON "ai_impact" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "ai_impact_impact_type_idx" ON "ai_impact" USING btree ("impact_type");--> statement-breakpoint
CREATE INDEX "ai_impact_attribution_confidence_idx" ON "ai_impact" USING btree ("attribution_confidence");--> statement-breakpoint
CREATE INDEX "ai_impact_record_status_idx" ON "ai_impact" USING btree ("record_status");--> statement-breakpoint
CREATE INDEX "ai_impact_status_event_date_idx" ON "ai_impact" USING btree ("record_status","event_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_impact_one_primary_per_company" ON "ai_impact" USING btree ("company_id") WHERE "ai_impact"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "company_slug_unique" ON "company" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "company_country_code_idx" ON "company" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "company_industry_idx" ON "company" USING btree ("industry");--> statement-breakpoint
CREATE INDEX "company_record_status_idx" ON "company" USING btree ("record_status");--> statement-breakpoint
CREATE INDEX "company_name_lower_idx" ON "company" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "company_aliases_idx" ON "company" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "source_ai_impact_id_idx" ON "source" USING btree ("ai_impact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_impact_url_unique" ON "source" USING btree ("ai_impact_id","url");--> statement-breakpoint
CREATE INDEX "source_link_health_idx" ON "source" USING btree ("link_health");