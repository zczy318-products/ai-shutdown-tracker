import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, sql } from "drizzle-orm";

import type { Database } from "../src/db";
import * as schema from "../src/db/schema";
import { canonicalSourceUrl, dueCandidates, fingerprint, importBatch, parseBatch, prepareCandidate, type Candidate } from "../src/lib/ingestion/import";
import { articleText, normalizeQuote, publicIpv4, retrieveSource, type RetrieveSource } from "../src/lib/ingestion/retrieve";
import { bootstrapCandidates, cronAuthorized, runDailyUpdate } from "../src/lib/ingestion/daily";

const client = new PGlite();
await client.waitReady;
const db = drizzle(client, { schema }) as unknown as Database;
await migrate(drizzle(client), { migrationsFolder: "drizzle" });
const quote = "The company said artificial intelligence enabled its planned workforce reduction.";
const record = {
  company: { slug: "ingestion-fixture", name: "Ingestion Fixture", countryCode: "US", industry: "software_saas", aliases: [], foundedYear: null },
  impact: { impactType: "ai_cost_cutting_layoff", attributionConfidence: "medium", outcome: "downsizing_announced",
    eventDate: "2026-10-01", eventDatePrecision: "month", summary: "据公司公开声明报道，公司表示采用人工智能后计划调整团队规模，但该声明未证明裁员已经完成。",
    employeesAffected: null, employeesAffectedPct: null,
    counterEvidence: "Company statement describes a plan; completion and AI-only allocation remain unverified." },
  sources: [{ url: "https://company.example/news", mediaName: "Company", sourceType: "primary_company",
    publishedAt: "2026-10-02", quote, quoteLang: "en", manuallyVerified: false }],
};
const candidate = (id = "fixture"): Candidate => ({ id, record: structuredClone(record), assessment: {
  method: "machine", model: "test-fixture", policyVersion: "test-v1", rationale: "Company explicitly attributed its planned reductions to AI; completion remains unknown.",
  evidenceUrls: [record.sources[0].url], independenceGroups: { [record.sources[0].url]: "company-statement" },
} });
const batch = (candidates: Candidate[]) => ({ schema_version: 1, batch_id: "local-test", candidates });
let retrievals = 0;
const retrieve: RetrieveSource = async (url) => {
  retrievals++;
  return { text: `Article text. ${quote} More article text.`, finalUrl: url, status: 200,
    retrievedAt: new Date().toISOString(), method: "local_test_fixture" };
};

try {
  const unmigrated = new PGlite();
  await unmigrated.waitReady;
  let unmigratedFetches = 0;
  try {
    await assert.rejects(importBatch(batch([candidate()]), { database: drizzle(unmigrated, { schema }) as unknown as Database,
      retrieve: async (url) => { unmigratedFetches++; return retrieve(url); } }));
    assert.equal(unmigratedFetches, 0, "missing migration fails before retrieval");
  } finally {
    await unmigrated.close();
  }
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
  assert.equal(canonicalSourceUrl("https://company.example/a?utm_source=x&v=1#x"), "https://company.example/a?v=1");
  assert.throws(() => parseBatch(batch([{ id: "duplicate" }, { id: "duplicate" }])));
  assert.equal(normalizeQuote(articleText("<script>bad()</script><p>Company &ldquo;statement&rdquo;.</p>")), 'Company "statement".');
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.168.1.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(publicIpv4(address), false, address);
  }
  assert.equal(publicIpv4("8.8.8.8"), true);
  assert.equal(cronAuthorized("Bearer test-secret", undefined), false);
  assert.equal(cronAuthorized("Bearer test-secret", ""), false);
  assert.equal(cronAuthorized("Bearer test-secret", "test-secret"), true);
  assert.equal(cronAuthorized("Bearer wrong", "test-secret"), false);
  assert.equal(cronAuthorized("Basic test-secret", "test-secret"), false);
  await assert.rejects(retrieveSource("https://127.0.0.1/test"), /not_public/);
  await assert.rejects(retrieveSource("http://example.com/"), /public_https/);
  await assert.rejects(retrieveSource("https://user:password@example.com/"), /public_https/);

  const before = await db.select().from(schema.aiImpact);
  assert.equal(before.length, 0);
  const preview = (await importBatch(batch([candidate()]), { dryRun: true, retrieve }))[0];
  assert.equal(preview.decision, "eligible", JSON.stringify(await prepareCandidate(candidate(), retrieve)));
  assert.equal((await db.select().from(schema.ingestionCandidate)).length, 0, "dry-run never writes");

  const incomplete = await importBatch(batch([{ id: "research-only", name: "Candidate", evidence: [] }]), { database: db, retrieve });
  assert.equal(incomplete[0].decision, "deferred");
  assert.equal((await db.select().from(schema.aiImpact)).length, 0, "candidate is not a public record");
  assert.equal((await db.select().from(schema.ingestionAttempt))[0].decision, "deferred");

  const manual = candidate("false-human-claim");
  (manual.record as typeof record).sources[0].manuallyVerified = true;
  assert.ok((await prepareCandidate(manual, retrieve)).reasons.includes("machine_cannot_claim_manual_verification"));
  assert.ok((await prepareCandidate(candidate(), async (url) => ({ text: "Unrelated article content", finalUrl: url, status: 200,
    retrievedAt: new Date().toISOString(), method: "local_test_fixture" }))).reasons.some((reason) => reason.startsWith("quote_not_found")));
  assert.ok((await prepareCandidate(candidate(), async (url) => ({ text: quote, finalUrl: url, status: 403,
    retrievedAt: new Date().toISOString(), method: "local_test_fixture" }))).reasons.some((reason) => reason.startsWith("source_http_403")));

  const invalidDate = candidate("invalid-date");
  (invalidDate.record as typeof record).impact.eventDate = "2026-02-30";
  assert.ok((await prepareCandidate(invalidDate, retrieve)).reasons.includes("invalid_calendar_date"));

  const failed = await importBatch(batch([candidate()]), { database: db, retrieve: async () => { throw new Error("offline"); } });
  assert.equal(failed[0].decision, "deferred");
  const published = await importBatch(batch([candidate()]), { database: db, retrieve });
  assert.equal(published[0].decision, "published", "failed fetch can retry unchanged input");
  const calls = retrievals;
  assert.equal((await importBatch(batch([candidate()]), { database: db, retrieve }))[0].decision, "unchanged");
  assert.equal(retrievals, calls, "successful duplicate batch does not refetch or rewrite");
  let rows = await db.select().from(schema.aiImpact);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reviewedBy, null);
  assert.equal(rows[0].reviewedAt, null, "machine publication is not human review");

  const more = candidate("same-event-other-discovery");
  (more.record as typeof record).sources[0].url = "https://second.example/story";
  const [originalSource] = await db.select().from(schema.source);
  Object.assign((more.record as typeof record).sources[0], { id: originalSource.id });
  (more.assessment as { evidenceUrls: string[] }).evidenceUrls = ["https://second.example/story"];
  assert.equal((await importBatch(batch([more]), { database: db, retrieve }))[0].decision, "published");
  rows = await db.select().from(schema.aiImpact);
  assert.equal(rows.length, 1, "event business key is idempotent across candidate IDs");
  const sources = await db.select().from(schema.source);
  assert.equal(sources.length, 2, "new discovery retains previous citations");
  assert.ok(sources.some((source) => source.id === originalSource.id && source.url === record.sources[0].url),
    "batch-supplied source IDs cannot overwrite existing citations");
  assert.ok(sources.every((source) => !source.manuallyVerified));
  const attempts = await db.select().from(schema.ingestionAttempt);
  const audit = attempts.find((attempt) => attempt.decision === "published")!;
  assert.ok(Array.isArray(audit.evidence.sources));

  const superseded = candidate("payload-race");
  const raced = await importBatch(batch([superseded]), { database: db, retrieve: async (url) => {
    await db.update(schema.ingestionCandidate).set({ payload: { id: superseded.id, revised: true }, status: "pending" })
      .where(eq(schema.ingestionCandidate.id, superseded.id));
    return retrieve(url);
  } });
  assert.ok(raced[0].reasons.includes("candidate_superseded"));
  assert.equal((await db.select().from(schema.ingestionCandidate).where(eq(schema.ingestionCandidate.id, superseded.id)))[0].status, "pending");

  await db.update(schema.aiImpact).set({ recordStatus: "archived" }).where(eq(schema.aiImpact.id, rows[0].id));
  const archived = candidate("archived-discovery");
  assert.ok((await importBatch(batch([archived]), { database: db, retrieve }))[0].reasons.includes("existing_event_not_published"));
  assert.equal((await db.select().from(schema.aiImpact))[0].recordStatus, "archived");

  await db.execute(sql`create function reject_ingestion_fixture() returns trigger language plpgsql as $$ begin
    if NEW.summary like '%force_failure%' then raise exception 'test write failure'; end if; return NEW; end $$`);
  await db.execute(sql`create trigger reject_ingestion_fixture before insert on ai_impact for each row execute function reject_ingestion_fixture()`);
  const rejected = candidate("transaction-failure");
  const rejectedRecord = rejected.record as typeof record;
  rejectedRecord.impact.eventDate = "2026-11-01";
  rejectedRecord.impact.summary += " force_failure";
  const failedWrite = await importBatch(batch([rejected]), { database: db, retrieve });
  assert.ok(failedWrite[0].reasons.includes("record_write_failed"));
  assert.equal((await db.select().from(schema.aiImpact)).length, 1, "failed write rolls back while audit persists");
  assert.equal((await db.select().from(schema.ingestionCandidate).where(eq(schema.ingestionCandidate.id, rejected.id)))[0].status, "retry");

  await db.update(schema.ingestionCandidate).set({ status: "retry", nextAttemptAt: new Date("2099-01-01") });
  const dailyCandidate = candidate("daily-fixture");
  (dailyCandidate.record as typeof record).impact.eventDate = "2026-12-01";
  await db.insert(schema.ingestionCandidate).values({ id: dailyCandidate.id, payload: dailyCandidate });
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const daily = runDailyUpdate({ database: db, bootstrap: false, day: "2026-11-10", maxCandidates: 1, retrieve: async (url) => {
    entered!();
    await wait;
    return retrieve(url);
  } });
  await started;
  const concurrent = await runDailyUpdate({ database: db, bootstrap: false, day: "2026-11-10", retrieve });
  assert.equal(concurrent.status, "already_running", "lease rejects concurrent triggers");
  release!();
  const completed = await daily;
  assert.equal(completed.status, "completed");
  assert.equal(completed.counts.processed, 1);
  assert.equal(completed.counts.published, 1);
  assert.equal((await runDailyUpdate({ database: db, bootstrap: false, day: "2026-11-10", retrieve })).status, "already_completed");

  await db.insert(schema.ingestionRun).values({ day: "2026-11-11", owner: "crashed", status: "running",
    leaseUntil: new Date("2000-01-01"), counts: { processed: 1, published: 0, deferred: 0, unchanged: 0 } });
  const recovered = await runDailyUpdate({ database: db, bootstrap: false, day: "2026-11-11", maxCandidates: 1, retrieve });
  assert.equal(recovered.status, "completed", "expired lease recovers without exceeding daily reservation");
  assert.equal(recovered.counts.processed, 1);

  await db.update(schema.ingestionCandidate).set({ nextAttemptAt: new Date("2099-01-01") });
  for (let i = 0; i < 6; i++) {
    await db.insert(schema.ingestionCandidate).values({ id: `fairness-${i}`, payload: { id: `fairness-${i}` } });
  }
  const firstDay = await runDailyUpdate({ database: db, bootstrap: false, day: "2026-11-12", maxCandidates: 3, retrieve });
  assert.equal(firstDay.counts.deferred, 3);
  await db.update(schema.ingestionCandidate).set({ nextAttemptAt: new Date("2000-01-01") })
    .where(sql`${schema.ingestionCandidate.id} like 'fairness-%'`);
  const secondDay = await runDailyUpdate({ database: db, bootstrap: false, day: "2026-11-13", maxCandidates: 3, retrieve });
  assert.equal(secondDay.counts.deferred, 3);
  const fairAttempts = await db.select().from(schema.ingestionAttempt).where(eq(schema.ingestionAttempt.batchId, "daily:2026-11-13"));
  assert.deepEqual(fairAttempts.map((attempt) => attempt.candidateId).sort(), ["fairness-3", "fairness-4", "fairness-5"],
    "never-attempted candidates run before yesterday's permanently incomplete candidates");

  const publicCount = (await db.select().from(schema.aiImpact)).length;
  assert.equal(await bootstrapCandidates(db), 26);
  assert.equal((await db.select().from(schema.aiImpact)).length, publicCount, "bootstrap never publishes candidates");
  assert.ok((await dueCandidates(db, 4)).every((candidate) => candidate.record), "complete new candidates take priority over incomplete new candidates");
  for (const historical of await dueCandidates(db, 4)) {
    const offline = await prepareCandidate(historical, async () => { throw new Error("offline_contract_check"); });
    assert.ok(!offline.reasons.includes("invalid_record_or_machine_assessment"), `${historical.id}: historical proposal satisfies the input contract`);
    assert.equal(offline.record, undefined, "offline contract check never establishes publishability");
  }
  const [bootstrapped] = await db.select().from(schema.ingestionCandidate).where(eq(schema.ingestionCandidate.id, "dnb:2026-10-06"));
  const enriched = { ...bootstrapped.payload, enriched: true };
  await db.update(schema.ingestionCandidate).set({ payload: enriched }).where(eq(schema.ingestionCandidate.id, bootstrapped.id));
  assert.equal(await bootstrapCandidates(db), 0);
  assert.deepEqual((await db.select().from(schema.ingestionCandidate).where(eq(schema.ingestionCandidate.id, bootstrapped.id)))[0].payload,
    enriched, "repeated bootstrap preserves enriched payloads");
  console.log("PASS ingestion: candidate isolation, quote/access checks, SSRF guards, dry-run, retries, audit, event/batch idempotency, source retention, and transactional rollback");
} finally {
  await client.close();
}
