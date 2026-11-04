import { randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, lt, ne } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import { ingestionCandidate, ingestionRun } from "@/db/schema";
import { dueCandidates, importBatch, parseBatch } from "./import";
import { retrieveSource, type RetrieveSource } from "./retrieve";
import historicalBackfill from "../../../research/2026-11-04-company-candidates/historical-backfill.json";

export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret?.trim() || !header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function bootstrapCandidates(db: Database): Promise<number> {
  const batch = parseBatch(historicalBackfill);
  const inserted = await db.insert(ingestionCandidate).values(batch.candidates.map((candidate) => ({
    id: candidate.id, payload: candidate,
  }))).onConflictDoNothing().returning({ id: ingestionCandidate.id });
  return inserted.length;
}

function bounded(raw: string | undefined, fallback: number, maximum: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}

export async function runDailyUpdate(options: { database?: Database; retrieve?: RetrieveSource;
  budgetMs?: number; maxCandidates?: number; day?: string; bootstrap?: boolean } = {}) {
  const db = options.database ?? await getDb();
  const day = options.day ?? new Date().toISOString().slice(0, 10);
  const budgetMs = Math.min(Math.max(options.budgetMs ?? bounded(process.env.INGESTION_BUDGET_MS, 40_000, 45_000), 1), 45_000);
  const maxCandidates = Math.min(Math.max(options.maxCandidates ?? bounded(process.env.INGESTION_DAILY_LIMIT, 3, 10), 1), 10);
  const deadline = Date.now() + budgetMs;
  const owner = randomUUID();
  const empty = { processed: 0, published: 0, deferred: 0, unchanged: 0 };
  const [claim] = await db.insert(ingestionRun).values({ day, owner, status: "running",
    leaseUntil: new Date(deadline + 10_000), counts: empty })
    .onConflictDoUpdate({ target: ingestionRun.day, set: { owner, status: "running", leaseUntil: new Date(deadline + 10_000), updatedAt: new Date() },
      setWhere: and(ne(ingestionRun.status, "completed"), lt(ingestionRun.leaseUntil, new Date())) })
    .returning();
  if (!claim) {
    const [run] = await db.select().from(ingestionRun).where(eq(ingestionRun.day, day));
    return { day, status: run?.status === "completed" ? "already_completed" : "already_running", counts: run?.counts ?? empty, discovery: "not_configured" };
  }
  const counts = { ...claim.counts };
  const owned = and(eq(ingestionRun.day, day), eq(ingestionRun.owner, owner));
  try {
    if (options.bootstrap !== false) await bootstrapCandidates(db);
    const candidates = await dueCandidates(db, Math.max(1, maxCandidates - counts.processed));
    for (const candidate of candidates) {
      if (counts.processed >= maxCandidates || Date.now() >= deadline) break;
      // Reserve the daily slot before I/O; a crash cannot create an unbounded retry loop.
      counts.processed++;
      const reserved = await db.update(ingestionRun).set({ counts: { ...counts }, updatedAt: new Date() })
        .where(and(owned, eq(ingestionRun.status, "running"))).returning({ day: ingestionRun.day });
      if (!reserved.length) throw new Error("ingestion_lease_lost");
      const retrieve = options.retrieve ?? ((url: string) => retrieveSource(url, Math.max(1, deadline - Date.now())));
      const [result] = await importBatch({ schema_version: 1, batch_id: `daily:${day}`, candidates: [candidate] },
        { database: db, retrieve, run: { day, owner } });
      if (result.decision !== "eligible") counts[result.decision]++;
      await db.update(ingestionRun).set({ counts: { ...counts }, updatedAt: new Date() }).where(owned);
    }
    const remaining = counts.processed < maxCandidates ? await dueCandidates(db, 1) : [];
    const status = remaining.length && Date.now() >= deadline ? "retry" : "completed";
    await db.update(ingestionRun).set({ status, counts, leaseUntil: new Date(), updatedAt: new Date() }).where(owned);
    return { day, status, counts, discovery: "not_configured" };
  } catch {
    await db.update(ingestionRun).set({ status: "retry", leaseUntil: new Date(), counts, updatedAt: new Date() }).where(owned);
    throw new Error("daily_ingestion_failed");
  }
}
