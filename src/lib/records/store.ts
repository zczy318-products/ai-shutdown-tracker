import { and, asc, count, desc, eq, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { aiImpact, company, source, type AiImpact, type Company, type Source } from "@/db/schema";
import { PUBLIC_RECORD_STATUS, type RecordStatus } from "@/lib/enums";

import type { RecordInput } from "./validation";

/**
 * Reads and writes for the company / ai_impact / source triple.
 *
 * A "record" in the admin UI is one `ai_impact` row plus its company and its
 * sources — that is the unit an editor enters, reviews and publishes.
 *
 * Reads here are **unfiltered by status** because the backoffice has to see
 * drafts. The public site never imports this module's list queries; it reads
 * through `./public.ts`, where every query starts from `record_status =
 * 'published'`.
 *
 * Writes always go through `saveRecord`, in one transaction, because the
 * database's "at least one source" trigger is deferred to commit: an impact and
 * its sources inserted in separate transactions would be rejected (correctly),
 * and an update that replaces the source list must not be observable in a state
 * where the list is empty.
 */

export type FullRecord = {
  impact: AiImpact;
  company: Company;
  sources: Source[];
};

export type RecordListItem = {
  impact: AiImpact;
  company: Company;
  sourceCount: number;
};

export const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type ListFilters = {
  status?: RecordStatus | "all";
  /** Matched against company name, Chinese name, slug and aliases. */
  q?: string;
  page?: number;
};

export function companyKeywordCondition(q: string): SQL | undefined {
  const needle = q.trim().toLowerCase();
  if (!needle) return undefined;
  const like = `%${needle}%`;
  return or(
    sql`lower(${company.name}) like ${like}`,
    sql`lower(coalesce(${company.nameZh}, '')) like ${like}`,
    sql`${company.slug} like ${like}`,
    // `?|` would need an array literal per dialect; a lateral unnest keeps the
    // predicate readable and still uses the GIN index for the equality case.
    sql`exists (select 1 from unnest(${company.aliases}) as alias where lower(alias) like ${like})`,
  );
}

export async function listRecords(filters: ListFilters): Promise<{
  items: RecordListItem[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const db = await getDb();
  const page = Math.max(1, Math.trunc(filters.page ?? 1));

  const conditions: SQL[] = [];
  if (filters.status && filters.status !== "all") {
    conditions.push(eq(aiImpact.recordStatus, filters.status));
  }
  const keyword = filters.q ? companyKeywordCondition(filters.q) : undefined;
  if (keyword) conditions.push(keyword);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(aiImpact)
    .innerJoin(company, eq(aiImpact.companyId, company.id))
    .where(where);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);

  const rows = await db
    .select({ impact: aiImpact, company })
    .from(aiImpact)
    .innerJoin(company, eq(aiImpact.companyId, company.id))
    .where(where)
    // Newest event first; `updated_at` breaks ties so a just-edited record does
    // not jump around between two rows sharing an event date.
    .orderBy(desc(aiImpact.eventDate), desc(aiImpact.updatedAt))
    .limit(PAGE_SIZE)
    .offset((safePage - 1) * PAGE_SIZE);

  const counts = await sourceCountsFor(rows.map((row) => row.impact.id));

  return {
    items: rows.map((row) => ({ ...row, sourceCount: counts.get(row.impact.id) ?? 0 })),
    total,
    page: safePage,
    pageCount,
  };
}

/** One grouped query rather than a count per row. Shared with `./public.ts`. */
export async function sourceCountsFor(impactIds: string[]): Promise<Map<string, number>> {
  if (impactIds.length === 0) return new Map();
  const db = await getDb();
  const rows = await db
    .select({ id: source.aiImpactId, value: count() })
    .from(source)
    .where(inArray(source.aiImpactId, impactIds))
    .groupBy(source.aiImpactId);
  return new Map(rows.map((row) => [row.id, Number(row.value)]));
}

export async function getRecord(impactId: string): Promise<FullRecord | null> {
  const db = await getDb();

  const rows = await db
    .select({ impact: aiImpact, company })
    .from(aiImpact)
    .innerJoin(company, eq(aiImpact.companyId, company.id))
    .where(eq(aiImpact.id, impactId))
    .limit(1);

  const row = rows.at(0);
  if (!row) return null;

  const sources = await db
    .select()
    .from(source)
    .where(eq(source.aiImpactId, impactId))
    .orderBy(asc(source.createdAt), asc(source.id));

  return { ...row, sources };
}

/**
 * Every published record with its sources, unpaginated.
 *
 * This is the **bulk** read — CSV export and the JSON API (T6) need the whole
 * set in one pass. The public *pages* do not use it: they read through
 * `./public.ts`, which paginates and filters. Both apply the same visibility
 * rule (`record_status = 'published'`) inside the query rather than leaving it
 * to the caller, so neither path can leak a draft.
 */
export async function listPublishedRecords(): Promise<FullRecord[]> {
  const db = await getDb();
  const rows = await db
    .select({ impact: aiImpact, company })
    .from(aiImpact)
    .innerJoin(company, eq(aiImpact.companyId, company.id))
    .where(eq(aiImpact.recordStatus, PUBLIC_RECORD_STATUS))
    .orderBy(desc(aiImpact.eventDate));

  if (rows.length === 0) return [];

  const sources = await db
    .select()
    .from(source)
    .where(
      inArray(
        source.aiImpactId,
        rows.map((row) => row.impact.id),
      ),
    )
    .orderBy(asc(source.publishedAt), asc(source.id));

  const grouped = new Map<string, Source[]>();
  for (const item of sources) {
    const list = grouped.get(item.aiImpactId);
    if (list) list.push(item);
    else grouped.set(item.aiImpactId, [item]);
  }

  return rows.map((row) => ({ ...row, sources: grouped.get(row.impact.id) ?? [] }));
}

export async function countByStatus(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db
    .select({ status: aiImpact.recordStatus, value: count() })
    .from(aiImpact)
    .groupBy(aiImpact.recordStatus);
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.value)]));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export class RecordWriteError extends Error {
  constructor(
    message: string,
    /** Form field path, when the failure can be attributed to one. */
    readonly field?: string,
  ) {
    super(message);
    this.name = "RecordWriteError";
  }
}

/**
 * Inserts or updates a whole record in one transaction.
 *
 * The company is upserted by `slug`: an editor adding a second Chegg event
 * types the same slug rather than hunting for an id, and the unique index makes
 * that unambiguous.
 *
 * Sources are replaced wholesale — delete the rows that are gone, update the
 * ones that remain, insert the new ones. A replace is simpler to reason about
 * than a diff and, because the whole thing is one transaction, the deferred
 * "at least one source" trigger only ever sees the final state.
 */
export async function saveRecord(
  input: RecordInput,
  options: { impactId?: string; reviewedBy?: string | null; database?: Pick<Awaited<ReturnType<typeof getDb>>, "transaction">; machine?: boolean } = {},
): Promise<string> {
  const db = options.database ?? await getDb();
  const now = new Date();

  return db.transaction(async (tx) => {
    // --- company -----------------------------------------------------------
    const companyValues = {
      slug: input.company.slug,
      name: input.company.name,
      nameZh: input.company.nameZh,
      aliases: input.company.aliases,
      countryCode: input.company.countryCode,
      region: input.company.region,
      industry: input.company.industry,
      companySize: input.company.companySize,
      foundedYear: input.company.foundedYear,
      websiteUrl: input.company.websiteUrl,
      description: input.company.description,
      logoUrl: input.company.logoUrl,
    };

    const [companyRow] = await tx
      .insert(company)
      .values(companyValues)
      .onConflictDoUpdate({
        target: company.slug,
        set: { ...companyValues, updatedAt: now },
      })
      .returning({ id: company.id });

    // A company stays visible as long as any of its events is published, so the
    // company's own status follows the record being saved rather than being
    // edited separately.
    if (input.status === "published") {
      await tx
        .update(company)
        .set({ recordStatus: "published", updatedAt: now })
        .where(eq(company.id, companyRow.id));
    }

    // --- ai_impact ---------------------------------------------------------
    const impactValues = {
      companyId: companyRow.id,
      impactType: input.impact.impactType,
      attributionConfidence: input.impact.attributionConfidence,
      outcome: input.impact.outcome,
      eventDate: input.impact.eventDate,
      eventDatePrecision: input.impact.eventDatePrecision,
      summary: input.impact.summary,
      summaryEn: input.impact.summaryEn,
      employeesAffected: input.impact.employeesAffected,
      employeesAffectedPct: input.impact.employeesAffectedPct,
      revenueImpactNote: input.impact.revenueImpactNote,
      isPrimary: input.impact.isPrimary,
      counterEvidence: input.impact.counterEvidence,
      recordStatus: input.status,
      reviewNote: input.impact.reviewNote,
    };

    let impactId = options.impactId;

    if (impactId) {
      const updated = await tx
        .update(aiImpact)
        .set({ ...impactValues, updatedAt: now })
        .where(eq(aiImpact.id, impactId))
        .returning({ id: aiImpact.id });
      if (updated.length === 0) {
        throw new RecordWriteError("记录不存在或已被删除。");
      }
    } else {
      const [inserted] = await tx
        .insert(aiImpact)
        .values(impactValues)
        .returning({ id: aiImpact.id });
      impactId = inserted.id;
    }

    // --- sources -----------------------------------------------------------
    const keptIds = input.sources
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string");

    await tx
      .delete(source)
      .where(
        keptIds.length > 0
          ? and(eq(source.aiImpactId, impactId), notInArray(source.id, keptIds))
          : eq(source.aiImpactId, impactId),
      );

    for (const item of input.sources) {
      const values = {
        aiImpactId: impactId,
        url: item.url,
        mediaName: item.mediaName,
        sourceType: item.sourceType,
        publishedAt: item.publishedAt,
        title: item.title,
        author: item.author,
        quote: item.quote,
        quoteLang: item.quoteLang,
        quoteTranslationZh: item.quoteTranslationZh,
        archiveUrl: item.archiveUrl,
        linkHealth: item.linkHealth,
        manuallyVerified: item.manuallyVerified,
      };

      if (item.id) {
        await tx
          .update(source)
          .set({ ...values, updatedAt: now })
          .where(and(eq(source.id, item.id), eq(source.aiImpactId, impactId)));
      } else {
        await tx.insert(source).values(values);
      }
    }

    // --- review stamp ------------------------------------------------------
    if (!options.machine && (input.status === "published" || input.status === "rejected")) {
      await tx
        .update(aiImpact)
        .set({ reviewedBy: options.reviewedBy ?? null, reviewedAt: now })
        .where(eq(aiImpact.id, impactId));
    }

    return impactId;
  });
}

/** Status-only transition. Publishing goes through `publishRecord` instead. */
export async function setRecordStatus(
  impactId: string,
  status: RecordStatus,
  options: { reviewNote?: string | null; reviewedBy?: string | null } = {},
): Promise<void> {
  const db = await getDb();
  const now = new Date();

  await db
    .update(aiImpact)
    .set({
      recordStatus: status,
      updatedAt: now,
      ...(options.reviewNote !== undefined ? { reviewNote: options.reviewNote } : {}),
      ...(status === "published" || status === "rejected" || status === "archived"
        ? { reviewedBy: options.reviewedBy ?? null, reviewedAt: now }
        : {}),
    })
    .where(eq(aiImpact.id, impactId));
}

/**
 * Hard-deletes a record. Restricted to drafts by the caller: dictionary §0 says
 * no physical deletes, and taking a record off the site is `archived`. A draft
 * that was mistyped and never published has nothing to preserve, so removing it
 * is the honest option rather than leaving debris in the review queue.
 */
export async function deleteDraftRecord(impactId: string): Promise<void> {
  const db = await getDb();
  await db.delete(aiImpact).where(and(eq(aiImpact.id, impactId), eq(aiImpact.recordStatus, "draft")));
}
