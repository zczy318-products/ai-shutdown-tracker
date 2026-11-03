CREATE TYPE "public"."billing_interval" AS ENUM('monthly', 'annual');--> statement-breakpoint
ALTER TABLE "billing_events" ADD COLUMN "interval_after" "billing_interval";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_interval" "billing_interval";--> statement-breakpoint
-- Backfill, inserted by hand into the generated migration.
--
-- `users_plan_interval_matches_plan` below requires every pro row to name a
-- billing cycle, and the rows already in the production database name none —
-- the column did not exist until this migration. Adding the constraint first
-- would abort the migration on the live data, so the backfill has to run in
-- between.
--
-- Why 'monthly' is a fact here and not a guess: the annual price did not exist
-- before this migration. US$9.90 / 月 was the only thing that could be bought
-- (shipped 2026-11-03, verified live at 15:50), so every pre-existing pro row
-- is a monthly subscription by construction, not by inference. The day that
-- stops being true is the day someone writes an annual row, and that can only
-- happen after this migration has run.
--
-- `billing_events.interval_after` is deliberately NOT backfilled. That table
-- records what each event told us, and the historical events carried no
-- interval; writing one in would put a derived value into an audit log.
UPDATE "users" SET "plan_interval" = 'monthly' WHERE "plan" = 'pro' AND "plan_interval" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_plan_interval_matches_plan" CHECK (case "users"."plan"
            when 'free' then "users"."plan_interval" is null
            when 'pro' then "users"."plan_interval" is not null
            else false
          end);
