import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Relative, not "@/lib/enums": drizzle-kit bundles this file with its own
// esbuild pass that does not read tsconfig path aliases.
import {
  ATTRIBUTION_CONFIDENCE_VALUES,
  COMPANY_SIZE_VALUES,
  EVENT_DATE_PRECISION_VALUES,
  IMPACT_TYPE_VALUES,
  INDUSTRY_VALUES,
  LINK_HEALTH_VALUES,
  OUTCOME_VALUES,
  RECORD_STATUS_VALUES,
  REGION_VALUES,
  SOURCE_TYPE_VALUES,
  SUBSCRIBER_STATUS_VALUES,
} from "../lib/enums";
import { PLAN_SOURCE_VALUES, PLAN_VALUES } from "../lib/plans";
import { BILLING_INTERVAL_VALUES } from "../lib/pricing";

/**
 * The single source of truth for the database schema.
 *
 * Everything here is plain `drizzle-orm/pg-core`, which is what lets the same
 * definitions drive both the local PGlite instance and a hosted Postgres — see
 * `src/db/index.ts`. Do not fork this file per driver.
 *
 * The domain tables follow the ZCZ-2 data dictionary §2–§4. Enum value arrays
 * are imported from `src/lib/enums.ts` rather than written out again, so a
 * database value and its UI label cannot drift.
 *
 * Two integrity rules the dictionary treats as non-negotiable are enforced here
 * in the database, not just in the forms:
 *
 *  - every `ai_impact` row has at least one `source` row — a deferred
 *    constraint trigger, see `drizzle/0002_record_integrity.sql`;
 *  - a `source` always carries `url` / `media_name` / `published_at` / `quote`
 *    — NOT NULL plus the CHECK constraints below.
 *
 * Nothing in this file infers attribution. `impact_type` and
 * `attribution_confidence` have no database default on purpose (dictionary
 * §1.6): a record cannot exist without a human having chosen both.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Maintained by the application layer; see `touch()` in src/lib/records/store.ts. */
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ---------------------------------------------------------------------------
// Enums (dictionary §1)
// ---------------------------------------------------------------------------

export const industryEnum = pgEnum("industry", INDUSTRY_VALUES);
export const regionEnum = pgEnum("region", REGION_VALUES);
export const companySizeEnum = pgEnum("company_size", COMPANY_SIZE_VALUES);
export const outcomeEnum = pgEnum("outcome", OUTCOME_VALUES);
export const impactTypeEnum = pgEnum("impact_type", IMPACT_TYPE_VALUES);
export const attributionConfidenceEnum = pgEnum(
  "attribution_confidence",
  ATTRIBUTION_CONFIDENCE_VALUES,
);
export const sourceTypeEnum = pgEnum("source_type", SOURCE_TYPE_VALUES);
export const recordStatusEnum = pgEnum("record_status", RECORD_STATUS_VALUES);
export const linkHealthEnum = pgEnum("link_health", LINK_HEALTH_VALUES);

/** Commercial packaging, not part of the dictionary — see `src/lib/plans.ts`. */
export const planEnum = pgEnum("plan", PLAN_VALUES);
export const planSourceEnum = pgEnum("plan_source", PLAN_SOURCE_VALUES);

/**
 * How often a pro subscription bills (ZCZ-14).
 *
 * Stored as the semantic value, never derived from the Stripe price id or the
 * amount. A price id is an opaque handle that *will* change — swapping test
 * mode for live mode is one such change — so `startsWith("price_annual")` or
 * `amount === 9504` is a permission check that breaks the day somebody creates
 * a new price in Stripe. `monthly` / `annual` is the fact we actually know, and
 * we know it at the moment *we* open the checkout session, which is where it
 * enters the system (`metadata[billing_interval]`).
 */
export const billingIntervalEnum = pgEnum("billing_interval", BILLING_INTERVAL_VALUES);

// ---------------------------------------------------------------------------
// Auth (T2 / ZCZ-3)
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stored already lower-cased and trimmed; see `normalizeEmail`. */
    email: text("email").notNull(),
    /** scrypt digest, never a reversible encoding. Format in `src/lib/password.ts`. */
    passwordHash: text("password_hash").notNull(),
    /**
     * Gates bulk export and API keys only (ZCZ-7 §0). Never gates reading:
     * the public pages do not look at this column, and must not start to.
     */
    plan: planEnum("plan").notNull().default("free"),
    /** Why the account is on this plan. `null` while it has never changed. */
    planSource: planSourceEnum("plan_source"),
    /**
     * Which billing cycle a pro account is on. `null` for free accounts — a
     * free account has no cycle, and the CHECK below makes that binding in both
     * directions, so "pro with no interval" cannot exist as a row.
     *
     * This column, not the Stripe price id, is what the UI and any future
     * entitlement question read.
     */
    planInterval: billingIntervalEnum("plan_interval"),
    planUpdatedAt: timestamp("plan_updated_at", { withTimezone: true }),
    /** Stripe *test mode* ids. Nothing here is ever a live-mode object. */
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    // Partial: the webhook looks an account up by customer id, and most rows
    // have none. Unique so two accounts cannot claim one Stripe customer.
    uniqueIndex("users_stripe_customer_id_unique")
      .on(table.stripeCustomerId)
      .where(sql`${table.stripeCustomerId} is not null`),
    // plan = 'free' ⇔ plan_interval is null. Same approach as the `subscriber`
    // lifecycle checks: the pairing is an invariant of the data, so it lives in
    // the database rather than in whichever code path last touched the row.
    //
    // `else false` rather than an open CASE: adding a third plan should fail
    // loudly here and force a decision about its billing cycle, instead of
    // silently inheriting "anything goes".
    check(
      "users_plan_interval_matches_plan",
      sql`case ${table.plan}
            when 'free' then ${table.planInterval} is null
            when 'pro' then ${table.planInterval} is not null
            else false
          end`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// API keys (ZCZ-7)
// ---------------------------------------------------------------------------

/**
 * One row per issued key. Same shape as `sessions`: only the SHA-256 of the
 * token is stored, so the plaintext key exists exactly once — in the response
 * that created it. Losing it means issuing a new one, which is the correct
 * trade and is said plainly in the UI.
 *
 * Revocation is a timestamp rather than a delete: "this key was revoked on the
 * 3rd" is a thing the owner of a key wants to be able to see.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Editor-supplied label, e.g. `研究脚本`. */
    name: varchar("name", { length: 80 }).notNull(),
    /** SHA-256 of the plaintext key. */
    tokenHash: text("token_hash").notNull(),
    /** First few characters, kept so the list can identify a key on sight. */
    tokenPrefix: varchar("token_prefix", { length: 24 }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_token_hash_unique").on(t.tokenHash),
    index("api_keys_user_id_idx").on(t.userId),
    check("api_keys_name_not_blank", sql`btrim(${t.name}) <> ''`),
  ],
);

// ---------------------------------------------------------------------------
// Billing events (ZCZ-7)
// ---------------------------------------------------------------------------

/**
 * An append-only log of every plan change, and the idempotency ledger for the
 * Stripe webhook.
 *
 * Stripe retries a webhook until it gets a 2xx, so the same
 * `checkout.session.completed` arrives more than once as a matter of course.
 * The unique index on `external_id` is what makes the second delivery a no-op
 * instead of a second upgrade. Simulated upgrades are logged here too, tagged
 * as such, so the demo trail and the Stripe trail read the same way.
 */
export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Stripe's `evt_…` id, or `sim:<uuid>` for a simulated upgrade. */
    externalId: text("external_id").notNull(),
    /** Stripe event type, or `simulated.upgrade` / `simulated.downgrade`. */
    type: text("type").notNull(),
    planAfter: planEnum("plan_after"),
    /**
     * The billing cycle *after* this event: `annual` on an annual upgrade,
     * `null` on a downgrade to free (no cycle) — and `null` on the rows written
     * before ZCZ-14, which carried no interval at all.
     *
     * No CHECK pairing this with `plan_after`, unlike `users.plan_interval`.
     * This table is an append-only record of what each event told us, and the
     * historical rows genuinely told us nothing about the cycle. A constraint
     * here would have forced the migration to write an inferred value into an
     * audit log, which is the one place a guess must never be stored.
     */
    intervalAfter: billingIntervalEnum("interval_after"),
    source: planSourceEnum("source").notNull(),
    /** Small human-readable note; never the full Stripe payload. */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("billing_events_external_id_unique").on(t.externalId),
    index("billing_events_user_id_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    /**
     * SHA-256 of the session token, not the token itself. The raw token only
     * ever lives in the client cookie, so a database leak cannot be replayed
     * as a login.
     */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

// ---------------------------------------------------------------------------
// company (dictionary §2)
// ---------------------------------------------------------------------------

/**
 * One row per company. The company itself carries no attribution conclusion —
 * everything causal lives on `ai_impact`, which is what keeps a company page
 * from implying a verdict the sources do not support.
 */
export const company = pgTable(
  "company",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** URL segment: lower-case, hyphenated. e.g. `chegg`, `the-planet-d`. */
    slug: varchar("slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    /** Chinese name; the front end falls back to `name` when absent. */
    nameZh: varchar("name_zh", { length: 200 }),
    /** Former names, parent companies, tickers — widens search hits. */
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** ISO 3166-1 alpha-2, upper-case. `ZZ` for multinational. */
    countryCode: char("country_code", { length: 2 }).notNull(),
    /** Derived from `countryCode` via `regionForCountry`, stored for aggregation. */
    region: regionEnum("region").notNull(),
    industry: industryEnum("industry").notNull(),
    /** Headcount band *before* the event. */
    companySize: companySizeEnum("company_size").notNull().default("unknown"),
    foundedYear: smallint("founded_year"),
    websiteUrl: text("website_url"),
    /** 1–3 neutral sentences about the business. Must not contain attribution. */
    description: text("description"),
    logoUrl: text("logo_url"),
    recordStatus: recordStatusEnum("record_status").notNull().default("draft"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("company_slug_unique").on(t.slug),
    index("company_country_code_idx").on(t.countryCode),
    index("company_industry_idx").on(t.industry),
    index("company_record_status_idx").on(t.recordStatus),
    // Matches the `lower(name) like …` keyword filter in the admin list.
    index("company_name_lower_idx").on(sql`lower(${t.name})`),
    index("company_aliases_idx").using("gin", t.aliases),
    check("company_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("company_country_code_format", sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    // The dictionary's upper bound is "the current year", which no CHECK can
    // express (Postgres requires immutable expressions). The loose bound here
    // catches typos; `companyInputSchema` applies the exact rule.
    check(
      "company_founded_year_range",
      sql`${t.foundedYear} is null or (${t.foundedYear} >= 1800 and ${t.foundedYear} <= 2100)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// ai_impact (dictionary §3)
// ---------------------------------------------------------------------------

/**
 * One row per AI-impact event. A company may have several (Chegg 2023 and 2025
 * are two separate events) — this is what the company timeline and the yearly
 * trend chart are built from. The listing shows the `isPrimary` row.
 */
export const aiImpact = pgTable(
  "ai_impact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    /** No default: AI's role in the event is always a human judgement. */
    impactType: impactTypeEnum("impact_type").notNull(),
    /** No default either — dictionary §1.6 requires an explicit grade. */
    attributionConfidence: attributionConfidenceEnum("attribution_confidence").notNull(),
    outcome: outcomeEnum("outcome").notNull(),
    /** Month-only dates use the 1st, year-only the 1st of January. */
    eventDate: date("event_date").notNull(),
    /** Tells the front end whether to render `2025-10-27` or `2025 年 10 月`. */
    eventDatePrecision: varchar("event_date_precision", { length: 5 }).notNull().default("day"),
    /** 2–4 neutral Chinese sentences, always reported speech («据 X 报道……»). */
    summary: text("summary").notNull(),
    summaryEn: text("summary_en"),
    employeesAffected: integer("employees_affected"),
    employeesAffectedPct: numeric("employees_affected_pct", { precision: 5, scale: 2 }),
    revenueImpactNote: text("revenue_impact_note"),
    /** The company's headline event; at most one per company. */
    isPrimary: boolean("is_primary").notNull().default(false),
    /** Denials, analysts citing other causes. Strongly expected on medium/low. */
    counterEvidence: text("counter_evidence"),
    recordStatus: recordStatusEnum("record_status").notNull().default("draft"),
    /** Required when `recordStatus` is `rejected`. */
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("ai_impact_company_id_idx").on(t.companyId),
    index("ai_impact_event_date_idx").on(t.eventDate),
    index("ai_impact_impact_type_idx").on(t.impactType),
    index("ai_impact_attribution_confidence_idx").on(t.attributionConfidence),
    index("ai_impact_record_status_idx").on(t.recordStatus),
    // The listing and the trend chart both read published rows newest-first.
    index("ai_impact_status_event_date_idx").on(t.recordStatus, t.eventDate.desc()),
    // Partial unique index: at most one primary event per company.
    uniqueIndex("ai_impact_one_primary_per_company")
      .on(t.companyId)
      .where(sql`${t.isPrimary}`),
    check(
      "ai_impact_event_date_precision_check",
      sql`${t.eventDatePrecision} in ('day','month','year')`,
    ),
    check(
      "ai_impact_employees_affected_check",
      sql`${t.employeesAffected} is null or ${t.employeesAffected} >= 0`,
    ),
    check(
      "ai_impact_employees_affected_pct_check",
      sql`${t.employeesAffectedPct} is null or (${t.employeesAffectedPct} >= 0 and ${t.employeesAffectedPct} <= 100)`,
    ),
    check("ai_impact_summary_length_check", sql`char_length(${t.summary}) between 30 and 800`),
  ],
);

// ---------------------------------------------------------------------------
// source (dictionary §4)
// ---------------------------------------------------------------------------

/**
 * One row per cited source, hanging off `ai_impact` rather than `company`:
 * different events at the same company have different evidence.
 *
 * `url` / `mediaName` / `publishedAt` / `quote` are NOT NULL and, for the two
 * text columns, CHECK-constrained against blank strings. A NOT NULL alone would
 * still accept `''`, which is exactly the shape of an unsourced record.
 */
export const source = pgTable(
  "source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiImpactId: uuid("ai_impact_id")
      .notNull()
      .references(() => aiImpact.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** Outlet or institution, e.g. `CNBC`, `Rest of World`. */
    mediaName: varchar("media_name", { length: 160 }).notNull(),
    sourceType: sourceTypeEnum("source_type").notNull(),
    publishedAt: date("published_at").notNull(),
    title: text("title"),
    author: varchar("author", { length: 200 }),
    /**
     * The verbatim quote, in the source's own language. Never translated,
     * rewritten, or stitched together from non-contiguous sentences — the
     * translation goes in `quoteTranslationZh` and is labelled as such.
     */
    quote: text("quote").notNull(),
    /** ISO 639-1. Drives the «英文原文» badge on the public page. */
    quoteLang: char("quote_lang", { length: 2 }).notNull().default("en"),
    /** Optional human translation. Always rendered marked as a translation. */
    quoteTranslationZh: text("quote_translation_zh"),
    /** Wayback / archive.today snapshot. Expected for bot-blocked sources. */
    archiveUrl: text("archive_url"),
    httpStatus: smallint("http_status"),
    linkHealth: linkHealthEnum("link_health").notNull().default("ok"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    /** The editor opened the URL in a browser. Required when `bot_blocked`. */
    manuallyVerified: boolean("manually_verified").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("source_ai_impact_id_idx").on(t.aiImpactId),
    // No duplicate citations of the same URL under one event.
    uniqueIndex("source_impact_url_unique").on(t.aiImpactId, t.url),
    index("source_link_health_idx").on(t.linkHealth),
    check("source_url_format", sql`${t.url} ~ '^https?://'`),
    check("source_quote_length_check", sql`char_length(${t.quote}) between 20 and 2000`),
    check("source_media_name_not_blank", sql`btrim(${t.mediaName}) <> ''`),
    check("source_quote_lang_format", sql`${t.quoteLang} ~ '^[a-z]{2}$'`),
  ],
);

// ---------------------------------------------------------------------------
// Email subscription (T10 / ZCZ-11) — deliberately not an account
// ---------------------------------------------------------------------------

export const subscriberStatusEnum = pgEnum("subscriber_status", SUBSCRIBER_STATUS_VALUES);

/**
 * One row per subscribed email address, with **no link to `users`**.
 *
 * A subscriber has no password, no session and no account: the only thing they
 * handed over is an address. Joining this table to `users` would quietly
 * reintroduce the registration wall the product owner removed, so the foreign
 * key that is not here is a feature. `users` keeps serving `/admin` and the pro
 * export; the two systems share nothing but the shape of an email column.
 *
 * Tokens follow the `sessions` rule: only the SHA-256 digest is stored. Someone
 * holding a database dump cannot confirm or unsubscribe anybody, because the
 * links we mailed are not recoverable from these columns.
 *
 * The lifecycle invariants are CHECK constraints rather than store-layer
 * conventions, because "a confirmed row still carries a usable confirm token"
 * is precisely the bug that makes a one-time token replayable.
 */
export const subscriber = pgTable(
  "subscriber",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Lower-cased and trimmed before insert; the CHECK below makes that binding. */
    email: text("email").notNull(),
    status: subscriberStatusEnum("status").notNull().default("pending"),
    /** SHA-256 of the confirm token. Nulled out the moment it is spent. */
    confirmTokenHash: text("confirm_token_hash"),
    confirmTokenExpiresAt: timestamp("confirm_token_expires_at", { withTimezone: true }),
    /**
     * SHA-256 of the unsubscribe token. Long-lived on purpose: it ships in every
     * email we ever send to this address, so expiring it would strand someone
     * with an old message and no one-click way out. Rotated on re-subscribe.
     */
    unsubTokenHash: text("unsub_token_hash").notNull(),
    /** Which page the signup came from, e.g. `home`, `company:chegg`. */
    source: varchar("source", { length: 120 }).notNull().default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("subscriber_email_unique").on(t.email),
    // Nullable unique: Postgres allows many NULLs, which is what we want once a
    // token has been spent. Unique so a token lookup cannot be ambiguous.
    uniqueIndex("subscriber_confirm_token_hash_unique").on(t.confirmTokenHash),
    uniqueIndex("subscriber_unsub_token_hash_unique").on(t.unsubTokenHash),
    index("subscriber_status_idx").on(t.status),
    // Normalization, enforced. `normalizeEmail` in the app does the same thing;
    // this stops a future code path from inserting `Foo@Example.COM` and
    // creating a second subscription for the same human.
    check("subscriber_email_normalized", sql`${t.email} = lower(btrim(${t.email}))`),
    // `\\.` so the SQL receives `\.` — in a template literal `\.` is just `.`,
    // which would let `a@b!c` through.
    check(
      "subscriber_email_format",
      sql`${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`,
    ),
    // A live confirm token exists if and only if the row is pending.
    check(
      "subscriber_confirm_token_pending_only",
      sql`case
            when ${t.status} = 'pending'
              then ${t.confirmTokenHash} is not null and ${t.confirmTokenExpiresAt} is not null
            else ${t.confirmTokenHash} is null and ${t.confirmTokenExpiresAt} is null
          end`,
    ),
    check(
      "subscriber_status_timestamps",
      sql`(${t.status} <> 'confirmed' or ${t.confirmedAt} is not null)
          and (${t.status} <> 'unsubscribed' or ${t.unsubscribedAt} is not null)`,
    ),
  ],
);

/**
 * Fixed-window counters for the public subscribe form.
 *
 * In the database rather than in memory because the deployment target is
 * serverless: every function instance gets its own heap, so an in-process
 * counter throttles one instance and the next request just lands somewhere
 * else. A row here is shared by every instance.
 *
 * `keyHash` is a digest, not the IP or the address. The throttle has to count
 * attempts for addresses that may never subscribe, and a plaintext log of
 * "someone tried to subscribe this person" is a worse privacy leak than the
 * subscription itself. Equality is all the counter needs.
 *
 * Fixed windows allow up to 2× the limit across a window boundary. Accepted:
 * this is abuse control for a one-field form, not a billing meter.
 */
export const subscribeThrottle = pgTable(
  "subscribe_throttle",
  {
    /** `ip` or `email` — see SUBSCRIBE_THROTTLE_SCOPES. */
    scope: varchar("scope", { length: 16 }).notNull(),
    keyHash: text("key_hash").notNull(),
    /** Start of the fixed window this counter belongs to. */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.keyHash, t.windowStart] }),
    // Supports the opportunistic prune of windows that can no longer be hit.
    index("subscribe_throttle_window_start_idx").on(t.windowStart),
    check("subscribe_throttle_scope_check", sql`${t.scope} in ('ip','email')`),
    check("subscribe_throttle_count_check", sql`${t.count} >= 0`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type BillingEvent = typeof billingEvents.$inferSelect;

export type Company = typeof company.$inferSelect;
export type NewCompany = typeof company.$inferInsert;
export type AiImpact = typeof aiImpact.$inferSelect;
export type NewAiImpact = typeof aiImpact.$inferInsert;
export type Source = typeof source.$inferSelect;
export type NewSource = typeof source.$inferInsert;

export type Subscriber = typeof subscriber.$inferSelect;
export type NewSubscriber = typeof subscriber.$inferInsert;
