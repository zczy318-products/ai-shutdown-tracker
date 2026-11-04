import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, type Database } from "@/db";
import { aiImpact, company, ingestionAttempt, ingestionCandidate, ingestionRun, source } from "@/db/schema";
import { checkPublishable } from "@/lib/records/publish";
import { saveRecord } from "@/lib/records/store";
import { recordInputSchema, type RecordInput } from "@/lib/records/validation";
import { normalizeQuote, retrieveSource, type RetrieveSource } from "./retrieve";

const assessmentSchema = z.object({
  method: z.literal("machine"),
  model: z.string().trim().min(1).max(200),
  policyVersion: z.string().trim().min(1).max(100),
  rationale: z.string().trim().min(20).max(4000),
  evidenceUrls: z.array(z.url()).min(1).max(20),
  // Syndicated copies belong to one group, regardless of host or URL count.
  independenceGroups: z.record(z.string(), z.string().trim().min(1)).default({}),
});
const candidateSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,199}$/),
  record: z.unknown().optional(),
  assessment: z.unknown().optional(),
}).passthrough();
const batchSchema = z.object({
  schema_version: z.literal(1),
  batch_id: z.string().trim().min(1).max(200).optional(),
  candidates: z.array(candidateSchema).min(1).max(100),
}).passthrough().superRefine((batch, ctx) => {
  const ids = new Set<string>();
  batch.candidates.forEach((candidate, index) => {
    if (ids.has(candidate.id)) ctx.addIssue({ code: "custom", path: ["candidates", index, "id"], message: "duplicate_candidate_id" });
    ids.add(candidate.id);
  });
});

export type Candidate = z.infer<typeof candidateSchema>;
export type IngestionBatch = z.infer<typeof batchSchema>;
export type ImportResult = { candidateId: string; decision: "published" | "deferred" | "unchanged" | "eligible"; reasons: string[]; impactId?: string };

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const fields = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}
export function parseBatch(raw: unknown): IngestionBatch {
  return batchSchema.parse(raw);
}

export function canonicalSourceUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href;
}

export type PreparedCandidate = { record?: RecordInput; reasons: string[]; evidence: Record<string, unknown> };

export async function prepareCandidate(candidate: Candidate, retrieve: RetrieveSource = retrieveSource): Promise<PreparedCandidate> {
  if (!candidate.record) return { reasons: ["candidate_incomplete"], evidence: {} };
  const raw = candidate.record as Record<string, unknown>;
  const parsed = recordInputSchema.safeParse({ ...raw, status: "published" });
  const assessment = assessmentSchema.safeParse(candidate.assessment);
  if (!parsed.success || !assessment.success) {
    return { reasons: ["invalid_record_or_machine_assessment"], evidence: {
      issues: [...(!parsed.success ? parsed.error.issues : []), ...(!assessment.success ? assessment.error.issues : [])],
    } };
  }
  const record = parsed.data;
  record.impact.reviewNote = null;
  // External batches never choose database row identities.
  for (const item of record.sources) delete item.id;
  const reasons: string[] = [];
  const dates = [record.impact.eventDate, ...record.sources.map((item) => item.publishedAt)];
  if (dates.some((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value;
  })) reasons.push("invalid_calendar_date");
  if ((record.impact.eventDatePrecision === "month" && !record.impact.eventDate.endsWith("-01")) ||
      (record.impact.eventDatePrecision === "year" && !record.impact.eventDate.endsWith("-01-01"))) reasons.push("date_precision_not_canonical");
  if (record.sources.some((item) => item.manuallyVerified)) reasons.push("machine_cannot_claim_manual_verification");
  if (!record.impact.counterEvidence) reasons.push("counter_evidence_assessment_required");
  const urls = new Set(record.sources.map((item) => canonicalSourceUrl(item.url)));
  if (urls.size !== record.sources.length) reasons.push("duplicate_canonical_source_url");
  if (assessment.data.evidenceUrls.some((url) => !urls.has(canonicalSourceUrl(url)))) reasons.push("assessment_evidence_not_in_record");
  if (record.impact.attributionConfidence === "high") {
    const groups = new Set(record.sources.map((item) => assessment.data.independenceGroups[item.url]).filter(Boolean));
    if (groups.size < 2) reasons.push("high_requires_two_independent_evidence_groups");
  }
  if (reasons.length) return { reasons, evidence: { assessment: assessment.data } };

  const checks: Record<string, unknown>[] = [];
  for (const item of record.sources) {
    try {
      const fetched = await retrieve(item.url);
      if (fetched.status < 200 || fetched.status >= 300) throw new Error(`source_http_${fetched.status}`);
      const text = normalizeQuote(fetched.text);
      const quote = normalizeQuote(item.quote);
      const offset = text.indexOf(quote);
      checks.push({ url: item.url, finalUrl: fetched.finalUrl, retrievedAt: fetched.retrievedAt,
        httpStatus: fetched.status, method: fetched.method, contentHash: fingerprint(text),
        quoteHash: fingerprint(quote), quoteMatch: offset >= 0, quoteOffset: offset,
        extractorVersion: "normalized_text_v1" });
      if (offset < 0) reasons.push(`quote_not_found:${item.url}`);
      item.linkHealth = "ok";
      item.manuallyVerified = false;
    } catch (error) {
      // Audit codes are bounded; never persist provider credentials or response bodies.
      const message = error instanceof Error ? error.message : "";
      const code = /^source_(http_\d{3}|timeout|dns_timeout|address_not_public|url_requires_public_https|not_plain_text_or_html|response_too_large|redirect_limit)$/.test(message)
        ? message : "source_retrieval_failed";
      checks.push({ url: item.url, error: code });
      reasons.push(`${code}:${item.url}`);
    }
  }
  const gate = checkPublishable({ ...record.impact, sources: record.sources });
  reasons.push(...gate.errors.map((error) => `publish_gate:${error}`));
  return { record: reasons.length ? undefined : record, reasons,
    evidence: { assessment: assessment.data, sources: checks, warnings: gate.warnings } };
}

export async function importBatch(raw: unknown, options: { database?: Database; retrieve?: RetrieveSource; dryRun?: boolean; run?: { day: string; owner: string } } = {}): Promise<ImportResult[]> {
  const batch = parseBatch(raw);
  const batchId = batch.batch_id ?? `batch:${fingerprint(batch)}`;
  const results: ImportResult[] = [];
  const db = options.dryRun ? undefined : options.database ?? await getDb();
  // Missing migrations fail before fetching anything or changing public records.
  if (db) await db.select({ id: ingestionCandidate.id }).from(ingestionCandidate).limit(0);
  for (const candidate of batch.candidates) {
    const inputHash = fingerprint(candidate);
    if (db) {
      await db.insert(ingestionCandidate).values({ id: candidate.id, payload: candidate })
        .onConflictDoUpdate({ target: ingestionCandidate.id, set: { payload: candidate, status: "pending", updatedAt: new Date() } });
      const [done] = await db.select().from(ingestionAttempt).where(and(
        eq(ingestionAttempt.candidateId, candidate.id), eq(ingestionAttempt.inputHash, inputHash), eq(ingestionAttempt.decision, "published"),
      )).limit(1);
      if (done) {
        await db.update(ingestionCandidate).set({ status: "published", nextAttemptAt: null, lastError: null })
          .where(and(eq(ingestionCandidate.id, candidate.id), eq(ingestionCandidate.payload, candidate)));
        results.push({ candidateId: candidate.id, decision: "unchanged", reasons: [], impactId: done.impactId ?? undefined });
        continue;
      }
    }
    const prepared = await prepareCandidate(candidate, options.retrieve);
    if (!db) {
      results.push({ candidateId: candidate.id, decision: prepared.record ? "eligible" : "deferred", reasons: prepared.reasons });
      continue;
    }
    const result = await db.transaction(async (tx): Promise<ImportResult> => {
      // Match saveRecord's company-before-event order to avoid lock inversion with editors.
      await tx.execute(sql`lock table company, ai_impact in share row exclusive mode`);
      if (options.run) {
        const [run] = await tx.select().from(ingestionRun).where(eq(ingestionRun.day, options.run.day)).for("update");
        if (!run || run.owner !== options.run.owner || run.status !== "running" || run.leaseUntil <= new Date()) {
          throw new Error("ingestion_lease_lost");
        }
      }
      const [current] = await tx.select().from(ingestionCandidate).where(eq(ingestionCandidate.id, candidate.id)).for("update");
      if (!current || fingerprint(current.payload) !== inputHash) {
        await tx.insert(ingestionAttempt).values({ candidateId: candidate.id, batchId, inputHash,
          decision: "deferred", reasons: ["candidate_superseded"], evidence: prepared.evidence });
        return { candidateId: candidate.id, decision: "deferred", reasons: ["candidate_superseded"] };
      }
      const [done] = await tx.select().from(ingestionAttempt).where(and(
        eq(ingestionAttempt.candidateId, candidate.id), eq(ingestionAttempt.inputHash, inputHash), eq(ingestionAttempt.decision, "published"),
      )).limit(1);
      if (done) return { candidateId: candidate.id, decision: "unchanged", reasons: [], impactId: done.impactId ?? undefined };
      let impactId: string | undefined;
      const reasons = [...prepared.reasons];
      if (prepared.record) {
        const record = prepared.record;
        const [knownCompany] = await tx.select().from(company).where(eq(company.slug, record.company.slug)).limit(1);
        if (knownCompany) record.company = knownCompany;
        const existing = await tx.select({ impact: aiImpact, company }).from(aiImpact)
          .innerJoin(company, eq(aiImpact.companyId, company.id)).where(and(
            eq(company.slug, record.company.slug), eq(aiImpact.eventDate, record.impact.eventDate), eq(aiImpact.impactType, record.impact.impactType),
          ));
        if (existing.length > 1) reasons.push("ambiguous_existing_event");
        else if (existing[0] && existing[0].impact.recordStatus !== "published") reasons.push("existing_event_not_published");
        else {
          const previous = existing[0];
          if (previous) {
            const sources = await tx.select().from(source).where(eq(source.aiImpactId, previous.impact.id));
            const known = new Set(sources.map((item) => canonicalSourceUrl(item.url)));
            // Keep existing citations and company metadata; discovery must not erase them.
            record.sources = [...sources, ...record.sources.filter((item) => !known.has(canonicalSourceUrl(item.url)))];
            record.impact.isPrimary = previous.impact.isPrimary;
            record.impact.reviewNote = previous.impact.reviewNote;
          } else {
            const [primary] = await tx.select({ id: aiImpact.id }).from(aiImpact).innerJoin(company, eq(aiImpact.companyId, company.id))
              .where(and(eq(company.slug, record.company.slug), eq(aiImpact.isPrimary, true))).limit(1);
            record.impact.isPrimary = !primary;
          }
          try {
            impactId = await saveRecord(record, { impactId: previous?.impact.id, database: tx, machine: true });
          } catch {
            reasons.push("record_write_failed");
          }
        }
      }
      const decision = impactId ? "published" : "deferred";
      await tx.insert(ingestionAttempt).values({ candidateId: candidate.id, batchId, inputHash, decision,
        reasons, evidence: prepared.evidence, impactId: impactId ?? null });
      await tx.update(ingestionCandidate).set({ status: impactId ? "published" : "retry",
        lastError: reasons.join("; ").slice(0, 4000) || null, lastAttemptAt: new Date(),
        nextAttemptAt: impactId ? null : new Date(new Date().setUTCHours(24, 0, 0, 0)), updatedAt: new Date(),
      }).where(eq(ingestionCandidate.id, candidate.id));
      return { candidateId: candidate.id, decision, reasons, impactId };
    });
    results.push(result);
  }
  return results;
}

export async function dueCandidates(database?: Database, limit = 20): Promise<Candidate[]> {
  const db = database ?? await getDb();
  const rows = await db.select({ payload: ingestionCandidate.payload }).from(ingestionCandidate)
    .where(and(inArray(ingestionCandidate.status, ["pending", "retry"]),
      or(isNull(ingestionCandidate.nextAttemptAt), lte(ingestionCandidate.nextAttemptAt, new Date()))))
    .orderBy(sql`${ingestionCandidate.lastAttemptAt} asc nulls first`,
      sql`(${ingestionCandidate.payload} -> 'record' is not null and ${ingestionCandidate.payload} -> 'record' <> 'null'::jsonb) desc`,
      ingestionCandidate.createdAt, ingestionCandidate.id)
    .limit(Math.min(100, Math.max(1, Math.trunc(limit))));
  return rows.map(({ payload }) => candidateSchema.parse(payload));
}
