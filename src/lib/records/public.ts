import { and, asc, count, countDistinct, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { aiImpact, company, source, type AiImpact, type Company, type Source } from "@/db/schema";
import {
  ATTRIBUTION_CONFIDENCE_VALUES,
  IMPACT_TYPE_VALUES,
  INDUSTRY_VALUES,
  PUBLIC_RECORD_STATUS,
  REGION_VALUES,
  isCountryCode,
  type AttributionConfidence,
  type ImpactType,
  type Industry,
  type Region,
} from "@/lib/enums";

import { companyKeywordCondition, sourceCountsFor } from "./store";

/**
 * Every read the public site is allowed to make.
 *
 * This module exists separately from `store.ts` for one reason: the backoffice
 * must see drafts and the public site must never see them, and that difference
 * is easier to audit when the public queries live in one file where *every*
 * query starts from `publishedOnly()`. A page cannot forget the status filter,
 * because a page never writes a `where` clause at all.
 *
 * Nothing here derives or softens attribution. `impact_type`,
 * `attribution_confidence` and `counter_evidence` are passed through exactly as
 * an editor graded them; the aggregates in `getPublicStats` count rows and
 * nothing else.
 */

export const PUBLIC_PAGE_SIZE = 12;

/** `published` is the only publicly visible status — dictionary §1.8. */
function publishedOnly(): SQL {
  return eq(aiImpact.recordStatus, PUBLIC_RECORD_STATUS);
}

// ---------------------------------------------------------------------------
// Filters (URL <-> query)
// ---------------------------------------------------------------------------

export const PUBLIC_SORTS = {
  date_desc: "事件日期（新→旧）",
  date_asc: "事件日期（旧→新）",
  name_asc: "公司名（A→Z）",
  name_desc: "公司名（Z→A）",
} as const;
export type PublicSort = keyof typeof PUBLIC_SORTS;
export const DEFAULT_SORT: PublicSort = "date_desc";

export type PublicFilters = {
  q: string;
  year: number | null;
  industry: Industry | null;
  country: string | null;
  impactType: ImpactType | null;
  confidence: AttributionConfidence | null;
  sort: PublicSort;
  page: number;
};

/** What `page.tsx` receives from Next: a value may be absent or repeated. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function one(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
}

function member<T extends string>(values: readonly string[], raw: string): T | null {
  return values.includes(raw) ? (raw as T) : null;
}

/**
 * Parses the query string into filters, **discarding** anything unrecognised
 * rather than throwing. A shared link with a stale `?industry=…` should degrade
 * to the unfiltered listing, not to an error page — and because every value is
 * checked against the enum here, nothing unvalidated reaches a comparison.
 */
export function parsePublicFilters(raw: RawSearchParams): PublicFilters {
  const year = Number(one(raw.year));
  const page = Number(one(raw.page));
  const country = one(raw.country).toUpperCase();

  return {
    q: one(raw.q).slice(0, 80),
    year: Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null,
    industry: member<Industry>(INDUSTRY_VALUES, one(raw.industry)),
    country: isCountryCode(country) ? country : null,
    impactType: member<ImpactType>(IMPACT_TYPE_VALUES, one(raw.impactType)),
    confidence: member<AttributionConfidence>(ATTRIBUTION_CONFIDENCE_VALUES, one(raw.confidence)),
    sort: member<PublicSort>(Object.keys(PUBLIC_SORTS), one(raw.sort)) ?? DEFAULT_SORT,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** True when the listing is showing something other than "everything". */
export function hasActiveFilters(filters: PublicFilters): boolean {
  return Boolean(
    filters.q || filters.year || filters.industry || filters.country || filters.impactType || filters.confidence,
  );
}

/**
 * Serialises filters back into a query string, which is what makes the listing
 * shareable: the page never holds filter state of its own, so a reload or a
 * pasted URL reproduces the same view. Defaults are omitted to keep URLs short.
 */
export function publicFiltersToQuery(
  filters: PublicFilters,
  overrides: Partial<PublicFilters> = {},
): string {
  const merged = { ...filters, ...overrides };
  const search = new URLSearchParams();
  if (merged.q) search.set("q", merged.q);
  if (merged.year) search.set("year", String(merged.year));
  if (merged.industry) search.set("industry", merged.industry);
  if (merged.country) search.set("country", merged.country);
  if (merged.impactType) search.set("impactType", merged.impactType);
  if (merged.confidence) search.set("confidence", merged.confidence);
  if (merged.sort !== DEFAULT_SORT) search.set("sort", merged.sort);
  if (merged.page > 1) search.set("page", String(merged.page));
  return search.toString();
}

export function publicListingHref(
  filters: PublicFilters,
  overrides: Partial<PublicFilters> = {},
): string {
  const query = publicFiltersToQuery(filters, overrides);
  return query ? `/impact?${query}` : "/impact";
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export type PublicListItem = {
  impact: AiImpact;
  company: Company;
  sourceCount: number;
};

function filterConditions(filters: PublicFilters): SQL[] {
  const conditions: SQL[] = [publishedOnly()];

  const keyword = filters.q ? companyKeywordCondition(filters.q) : undefined;
  if (keyword) conditions.push(keyword);
  if (filters.year !== null) {
    conditions.push(sql`cast(extract(year from ${aiImpact.eventDate}) as integer) = ${filters.year}`);
  }
  if (filters.industry) conditions.push(eq(company.industry, filters.industry));
  if (filters.country) conditions.push(eq(company.countryCode, filters.country));
  if (filters.impactType) conditions.push(eq(aiImpact.impactType, filters.impactType));
  if (filters.confidence) conditions.push(eq(aiImpact.attributionConfidence, filters.confidence));

  return conditions;
}

/**
 * Sorted by a *stable* key in every mode. `lower(name)` rather than `name`
 * because PGlite and a managed Postgres can disagree on collation, and an
 * acceptance run that counts rows per page must not depend on which one is
 * live. The secondary key keeps two rows sharing an event date in a fixed
 * order, so page 2 cannot repeat a row from page 1.
 */
function orderFor(sort: PublicSort): SQL[] {
  const name = sql`lower(${company.name})`;
  switch (sort) {
    case "date_asc":
      return [asc(aiImpact.eventDate), asc(name)];
    case "name_asc":
      return [asc(name), desc(aiImpact.eventDate)];
    case "name_desc":
      return [desc(name), desc(aiImpact.eventDate)];
    default:
      return [desc(aiImpact.eventDate), asc(name)];
  }
}

/**
 * One row per **event**, not per company: year, impact type and confidence are
 * all attributes of the event, so a company with two graded events shows up as
 * the two records it actually is. Chegg 2023 and Chegg 2025 differ in both
 * confidence and impact type — collapsing them would make either filter lie.
 */
export async function listPublicRecords(filters: PublicFilters): Promise<{
  items: PublicListItem[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const db = await getDb();
  const where = and(...filterConditions(filters));

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(aiImpact)
    .innerJoin(company, eq(aiImpact.companyId, company.id))
    .where(where);

  const pageCount = Math.max(1, Math.ceil(total / PUBLIC_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page), pageCount);

  const rows = await db
    .select({ impact: aiImpact, company })
    .from(aiImpact)
    .innerJoin(company, eq(aiImpact.companyId, company.id))
    .where(where)
    .orderBy(...orderFor(filters.sort))
    .limit(PUBLIC_PAGE_SIZE)
    .offset((page - 1) * PUBLIC_PAGE_SIZE);

  const counts = await sourceCountsFor(rows.map((row) => row.impact.id));

  return {
    items: rows.map((row) => ({ ...row, sourceCount: counts.get(row.impact.id) ?? 0 })),
    total,
    page,
    pageCount,
  };
}

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

export type FilterOption<T extends string | number> = { value: T; count: number };

/**
 * The values that actually occur in published data, with counts.
 *
 * Counts are of the whole published set, not of the current filter selection:
 * a count that moved with the selection would tell a visitor how many rows they
 * would get *in combination with* the current filters, which is a different
 * question from "what is in this dataset". Years and countries have to come
 * from the data (country is a ~250-value open set); impact type and confidence
 * are small fixed enums and are listed in full by the page.
 */
export async function getPublicFilterOptions(): Promise<{
  years: FilterOption<number>[];
  industries: FilterOption<Industry>[];
  countries: FilterOption<string>[];
  impactTypes: Map<ImpactType, number>;
  confidences: Map<AttributionConfidence, number>;
}> {
  const db = await getDb();
  const year = sql<number>`cast(extract(year from ${aiImpact.eventDate}) as integer)`;

  const [years, industries, countries, impactTypes, confidences] = await Promise.all([
    db
      .select({ value: year, count: count() })
      .from(aiImpact)
      .where(publishedOnly())
      .groupBy(year)
      .orderBy(desc(year)),
    db
      .select({ value: company.industry, count: count() })
      .from(aiImpact)
      .innerJoin(company, eq(aiImpact.companyId, company.id))
      .where(publishedOnly())
      .groupBy(company.industry)
      // Ties broken by the enum column, which Postgres sorts in *declaration*
      // order — i.e. the dictionary's own order — so equal counts come back the
      // same way on every load instead of shuffling between requests.
      .orderBy(desc(count()), asc(company.industry)),
    db
      .select({ value: company.countryCode, count: count() })
      .from(aiImpact)
      .innerJoin(company, eq(aiImpact.companyId, company.id))
      .where(publishedOnly())
      .groupBy(company.countryCode)
      .orderBy(desc(count()), asc(company.countryCode)),
    db
      .select({ value: aiImpact.impactType, count: count() })
      .from(aiImpact)
      .where(publishedOnly())
      .groupBy(aiImpact.impactType),
    db
      .select({ value: aiImpact.attributionConfidence, count: count() })
      .from(aiImpact)
      .where(publishedOnly())
      .groupBy(aiImpact.attributionConfidence),
  ]);

  return {
    years: years.map((row) => ({ value: Number(row.value), count: Number(row.count) })),
    industries: industries.map((row) => ({ value: row.value, count: Number(row.count) })),
    countries: countries.map((row) => ({ value: row.value, count: Number(row.count) })),
    impactTypes: new Map(impactTypes.map((row) => [row.value, Number(row.count)])),
    confidences: new Map(confidences.map((row) => [row.value, Number(row.count)])),
  };
}

// ---------------------------------------------------------------------------
// Company page
// ---------------------------------------------------------------------------

export type PublicEvent = { impact: AiImpact; sources: Source[] };
export type PublicCompany = { company: Company; events: PublicEvent[] };

/**
 * A company and its published events, each with **all** of its sources.
 *
 * There is deliberately no limit anywhere in this function. The source list is
 * the product: a visitor has to be able to check every citation behind a grade,
 * so truncating it — even with a «展开更多» — would hide the evidence the page
 * exists to show. A company with no published event returns `null` and the page
 * 404s, rather than rendering a shell that implies a record we are not showing.
 */
export async function getPublicCompany(slug: string): Promise<PublicCompany | null> {
  const db = await getDb();

  const [row] = await db.select().from(company).where(eq(company.slug, slug)).limit(1);
  if (!row) return null;

  const impacts = await db
    .select()
    .from(aiImpact)
    .where(and(eq(aiImpact.companyId, row.id), publishedOnly()))
    .orderBy(desc(aiImpact.eventDate), desc(aiImpact.createdAt));

  if (impacts.length === 0) return null;

  const sources = await db
    .select()
    .from(source)
    .where(
      inArray(
        source.aiImpactId,
        impacts.map((impact) => impact.id),
      ),
    )
    // Oldest citation first: the detail page reads as the story the coverage
    // told, in the order it told it.
    .orderBy(asc(source.publishedAt), asc(source.id));

  const grouped = new Map<string, Source[]>();
  for (const item of sources) {
    const list = grouped.get(item.aiImpactId);
    if (list) list.push(item);
    else grouped.set(item.aiImpactId, [item]);
  }

  return {
    company: row,
    events: impacts.map((impact) => ({ impact, sources: grouped.get(impact.id) ?? [] })),
  };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** Industry has 21 values; the chart shows this many and folds the rest. */
export const INDUSTRY_CHART_SLOTS = 8;

export type Tally<T extends string | number> = { key: T; count: number };

export type PublicStats = {
  records: number;
  companies: number;
  sources: number;
  /** Ascending, with empty years filled in so a gap reads as a gap. */
  byYear: Tally<number>[];
  /** Top 8 by count; everything else folded into a single `other` row. */
  byIndustry: { key: Industry | "__rest__"; count: number; folded: number }[];
  byRegion: Tally<Region>[];
  byImpactType: Tally<ImpactType>[];
  byConfidence: Tally<AttributionConfidence>[];
};

/**
 * All dashboard aggregates, computed at request time.
 *
 * Every query filters on `published`, which is also what the page's stated
 * methodology says — the number on the page and the number in the database are
 * the same number. Nothing is cached: these are six grouped counts over a table
 * of tens of rows, and a stale dashboard is worse than a cheap one.
 */
export async function getPublicStats(): Promise<PublicStats> {
  const db = await getDb();
  const year = sql<number>`cast(extract(year from ${aiImpact.eventDate}) as integer)`;

  const [totals, sourceTotal, byYear, byIndustry, byRegion, byImpactType, byConfidence] =
    await Promise.all([
      db
        .select({ records: count(), companies: countDistinct(aiImpact.companyId) })
        .from(aiImpact)
        .where(publishedOnly()),
      db
        .select({ value: count() })
        .from(source)
        .innerJoin(aiImpact, eq(source.aiImpactId, aiImpact.id))
        .where(publishedOnly()),
      db
        .select({ key: year, count: count() })
        .from(aiImpact)
        .where(publishedOnly())
        .groupBy(year)
        .orderBy(asc(year)),
      db
        .select({ key: company.industry, count: count() })
        .from(aiImpact)
        .innerJoin(company, eq(aiImpact.companyId, company.id))
        .where(publishedOnly())
        .groupBy(company.industry)
        // Decides which industries make the top-8 chart slots when counts tie;
        // see the note in `getPublicFilterOptions`.
        .orderBy(desc(count()), asc(company.industry)),
      db
        .select({ key: company.region, count: count() })
        .from(aiImpact)
        .innerJoin(company, eq(aiImpact.companyId, company.id))
        .where(publishedOnly())
        .groupBy(company.region)
        .orderBy(desc(count())),
      db
        .select({ key: aiImpact.impactType, count: count() })
        .from(aiImpact)
        .where(publishedOnly())
        .groupBy(aiImpact.impactType),
      db
        .select({ key: aiImpact.attributionConfidence, count: count() })
        .from(aiImpact)
        .where(publishedOnly())
        .groupBy(aiImpact.attributionConfidence),
    ]);

  const industryTallies = byIndustry.map((row) => ({ key: row.key, count: Number(row.count) }));
  const head = industryTallies.slice(0, INDUSTRY_CHART_SLOTS);
  const tail = industryTallies.slice(INDUSTRY_CHART_SLOTS);
  const rest = tail.reduce((sum, row) => sum + row.count, 0);

  return {
    records: Number(totals[0]?.records ?? 0),
    companies: Number(totals[0]?.companies ?? 0),
    sources: Number(sourceTotal[0]?.value ?? 0),
    byYear: fillYearGaps(byYear.map((row) => ({ key: Number(row.key), count: Number(row.count) }))),
    byIndustry: [
      ...head.map((row) => ({ ...row, folded: 0 })),
      ...(rest > 0 ? [{ key: "__rest__" as const, count: rest, folded: tail.length }] : []),
    ],
    // Fixed enum order, zeroes included: a type with no records is information,
    // and a chart whose rows move between loads is unreadable.
    byRegion: orderedTally(REGION_VALUES, byRegion).filter((row) => row.count > 0),
    byImpactType: orderedTally(IMPACT_TYPE_VALUES, byImpactType),
    byConfidence: orderedTally(ATTRIBUTION_CONFIDENCE_VALUES, byConfidence),
  };
}

function orderedTally<T extends string>(
  values: readonly T[],
  rows: { key: string; count: number | string }[],
): Tally<T>[] {
  const found = new Map(rows.map((row) => [row.key, Number(row.count)]));
  return values.map((key) => ({ key, count: found.get(key) ?? 0 }));
}

/**
 * A year with no records must still occupy a column. Dropping it would compress
 * the x axis and draw a trend across a gap that is not in the data.
 */
function fillYearGaps(rows: Tally<number>[]): Tally<number>[] {
  if (rows.length === 0) return [];
  const first = rows[0].key;
  const last = rows[rows.length - 1].key;
  const found = new Map(rows.map((row) => [row.key, row.count]));
  const filled: Tally<number>[] = [];
  for (let year = first; year <= last; year++) {
    filled.push({ key: year, count: found.get(year) ?? 0 });
  }
  return filled;
}

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

export type LoadResult<T> = { ok: true; data: T } | { ok: false; error: unknown };

/**
 * Runs a public query and reports failure **as failure**.
 *
 * The rule this exists to keep (ZCZ-6, 2026-11-03): «读不到» and «确实没有»
 * must not render the same. So this never substitutes empty data for an error —
 * it returns a discriminated result, and its only callers render an explicit
 * «数据暂时读取失败» panel. A `catch` that returned `[]` would mean that the
 * day the database is unreachable the site announces «0 条记录», i.e. claims we
 * never recorded a single company.
 *
 * Why catch at all when `error.tsx` exists: Next flushes the page shell before
 * the data resolves, so a throw lands in the boundary *on the client* — the
 * initial HTML carries only the shell, and a visitor without JavaScript (or
 * with a failed chunk load) gets a blank page under the header. Catching here
 * renders the same readable state on the server. `error.tsx` stays as the
 * backstop for everything this does not wrap.
 */
export async function loadPublic<T>(load: () => Promise<T>): Promise<LoadResult<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    // The one place this is observable: the server log. Nothing is swallowed.
    console.error("[public] query failed:", error);
    return { ok: false, error };
  }
}
