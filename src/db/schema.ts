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
} from "../lib/enums";

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
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;

export type Company = typeof company.$inferSelect;
export type NewCompany = typeof company.$inferInsert;
export type AiImpact = typeof aiImpact.$inferSelect;
export type NewAiImpact = typeof aiImpact.$inferInsert;
export type Source = typeof source.$inferSelect;
export type NewSource = typeof source.$inferInsert;
