/**
 * Imports `seed/companies.json` (ZCZ-5 / T4) into whichever database is
 * configured, then prints what landed so it can be reconciled against
 * `docs/SEED_VERIFICATION.md`.
 *
 *   npm run db:seed                                   # local PGlite
 *   DATABASE_URL='postgres://...' npm run db:seed     # Neon (direct string)
 *   npm run db:seed -- --dry-run                      # validate only, no writes
 *   SEED_FILE=path/to/other.json npm run db:seed
 *
 * Two properties this script is built around:
 *
 * 1. **It never relaxes validation.** Every record goes through the same
 *    `recordInputSchema` + `checkPublishable` the admin backoffice uses, and
 *    the whole run is validated *before* anything is written. One record
 *    missing a source URL or a verbatim quote fails the run with a non-zero
 *    exit and writes nothing — the fix belongs in the dataset, never here.
 *
 * 2. **It is idempotent.** Records are matched on the business key
 *    `(company.slug, event_date, impact_type)` and updated in place, so running
 *    it twice against Neon leaves the same 30 rows rather than 60. Sources are
 *    replaced wholesale by `saveRecord`, inside the record's transaction.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { config } from "dotenv";
import { count, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { aiImpact, company, source } from "@/db/schema";
import { regionForCountry } from "@/lib/enums";
import { checkPublishable } from "@/lib/records/publish";
import { saveRecord } from "@/lib/records/store";
import { fieldErrorsOf, recordInputSchema, type RecordInput } from "@/lib/records/validation";

import { describeDbTarget, resolveDbTarget } from "./config";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const DEFAULT_SEED_FILE = path.join("seed", "companies.json");

/** Seed records are pre-reviewed by T4, so they land published. */
const SEED_STATUS = "published" as const;

// ---------------------------------------------------------------------------
// Dataset shape (dictionary §7: snake_case, companies with nested impacts)
// ---------------------------------------------------------------------------

const COMPANY_KEYS = [
  "slug",
  "name",
  "name_zh",
  "aliases",
  "country_code",
  "region",
  "industry",
  "company_size",
  "founded_year",
  "website_url",
  "description",
  "logo_url",
] as const;

const IMPACT_KEYS = [
  "impact_type",
  "attribution_confidence",
  "outcome",
  "event_date",
  "event_date_precision",
  "is_primary",
  "summary",
  "summary_en",
  "employees_affected",
  "employees_affected_pct",
  "revenue_impact_note",
  "counter_evidence",
  "sources",
] as const;

const SOURCE_KEYS = [
  "url",
  "media_name",
  "source_type",
  "published_at",
  "title",
  "author",
  "quote",
  "quote_lang",
  "quote_translation_zh",
  "archive_url",
  "link_health",
  "manually_verified",
] as const;

type Json = Record<string, unknown>;

/**
 * Fields that must be *present* in the dataset, with the label to print when
 * they are not.
 *
 * `recordInputSchema` already rejects these, but a form never omits a key, so
 * zod reports an absent one as `expected string, received undefined`. The
 * contract for this importer is to name what is missing — "第 3 条来源缺少必填项：
 * 原文引述（quote）" — so presence is checked here first.
 */
const REQUIRED_COMPANY_FIELDS: [string, string][] = [
  ["slug", "slug"],
  ["name", "公司名"],
  ["country_code", "国家代码"],
  ["industry", "行业"],
];

const REQUIRED_IMPACT_FIELDS: [string, string][] = [
  ["impact_type", "影响类型"],
  ["attribution_confidence", "归因置信度"],
  ["outcome", "结局"],
  ["event_date", "事件日期"],
  ["summary", "事件陈述"],
];

const REQUIRED_SOURCE_FIELDS: [string, string][] = [
  ["url", "来源 URL"],
  ["media_name", "媒体 / 机构名"],
  ["source_type", "来源类型"],
  ["published_at", "发布日期"],
  ["quote", "原文引述（quote）"],
];

function missingFields(value: Json, required: [string, string][]): string[] {
  return required
    .filter(([key]) => {
      const field = value[key];
      return field === undefined || field === null || (typeof field === "string" && !field.trim());
    })
    .map(([, label]) => label);
}

/**
 * Unknown keys are a hard failure rather than a silent drop. A field the
 * dataset gained and this importer does not know about would otherwise be
 * dropped on the floor without anyone noticing.
 */
function unknownKeys(value: Json, known: readonly string[], where: string): string[] {
  return Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => `${where} 出现未知字段 \`${key}\`，导入器不认识它。请确认是数据写错了还是导入器需要跟进。`);
}

function asJson(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

/** snake_case dataset → the camelCase shape `recordInputSchema` expects. */
function toRecordInput(entry: Json, impact: Json): unknown {
  const c = asJson(entry.company) ?? {};
  const sources = Array.isArray(impact.sources) ? impact.sources : [];

  return {
    company: {
      slug: c.slug,
      name: c.name,
      nameZh: c.name_zh,
      aliases: c.aliases,
      countryCode: c.country_code,
      industry: c.industry,
      companySize: c.company_size,
      foundedYear: c.founded_year,
      websiteUrl: c.website_url,
      description: c.description,
      logoUrl: c.logo_url,
    },
    impact: {
      impactType: impact.impact_type,
      attributionConfidence: impact.attribution_confidence,
      outcome: impact.outcome,
      eventDate: impact.event_date,
      eventDatePrecision: impact.event_date_precision,
      summary: impact.summary,
      summaryEn: impact.summary_en,
      employeesAffected: impact.employees_affected,
      employeesAffectedPct: impact.employees_affected_pct,
      revenueImpactNote: impact.revenue_impact_note,
      isPrimary: impact.is_primary,
      counterEvidence: impact.counter_evidence,
      reviewNote: null,
    },
    sources: (sources as Json[]).map((item) => ({
      url: item.url,
      mediaName: item.media_name,
      sourceType: item.source_type,
      publishedAt: item.published_at,
      title: item.title,
      author: item.author,
      quote: item.quote,
      quoteLang: item.quote_lang,
      quoteTranslationZh: item.quote_translation_zh,
      archiveUrl: item.archive_url,
      linkHealth: item.link_health,
      manuallyVerified: item.manually_verified,
    })),
    status: SEED_STATUS,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type Candidate = {
  /** 1-based position in the dataset, so a rejection names the record. */
  index: number;
  label: string;
  key: string;
  input: RecordInput;
  warnings: string[];
};

type Rejection = { index: number; label: string; problems: string[] };

/** The idempotency key. No unique index exists for it, so it is matched in SQL. */
function businessKey(slug: string, eventDate: string, impactType: string): string {
  return `${slug}|${eventDate}|${impactType}`;
}

function validate(dataset: Json[]): { candidates: Candidate[]; rejections: Rejection[] } {
  const candidates: Candidate[] = [];
  const rejections: Rejection[] = [];
  const seenKeys = new Map<string, number>();
  let index = 0;

  dataset.forEach((entry, entryIndex) => {
    const structural: string[] = [];
    const companyJson = asJson(entry.company);
    const impacts = Array.isArray(entry.impacts) ? (entry.impacts as unknown[]) : null;

    if (!companyJson) structural.push("缺少 `company` 对象。");
    if (!impacts || impacts.length === 0) structural.push("缺少 `impacts` 数组或为空。");

    const slug = typeof companyJson?.slug === "string" ? companyJson.slug : `#${entryIndex + 1}`;

    if (structural.length > 0) {
      rejections.push({ index: ++index, label: slug, problems: structural });
      return;
    }

    structural.push(...unknownKeys(entry, ["company", "impacts"], `公司 ${slug} 的顶层`));
    structural.push(...unknownKeys(companyJson!, COMPANY_KEYS, `公司 ${slug} 的 company`));

    // §1.2: region is derived from the country, never chosen. The dataset
    // carries it for readability; a disagreement means one of the two is wrong,
    // and silently preferring the derived value would hide that.
    const declaredRegion = companyJson!.region;
    if (typeof companyJson!.country_code === "string" && typeof declaredRegion === "string") {
      const derived = regionForCountry(companyJson!.country_code.toUpperCase());
      if (derived !== declaredRegion) {
        structural.push(
          `company.region 为 \`${declaredRegion}\`，但按 country_code \`${companyJson!.country_code}\` 推导出的是 \`${derived}\`。` +
            "region 是派生字段，两者不一致说明其中一个写错了。",
        );
      }
    }

    for (const raw of impacts!) {
      index += 1;
      const impactJson = asJson(raw);
      const problems = [...structural];

      if (!impactJson) {
        rejections.push({ index, label: slug, problems: [...problems, "impacts 里有一项不是对象。"] });
        continue;
      }

      problems.push(...unknownKeys(impactJson, IMPACT_KEYS, `${slug} 的 impact`));

      const companyMissing = missingFields(companyJson!, REQUIRED_COMPANY_FIELDS);
      if (companyMissing.length > 0) problems.push(`公司缺少必填项：${companyMissing.join("、")}。`);
      const impactMissing = missingFields(impactJson, REQUIRED_IMPACT_FIELDS);
      if (impactMissing.length > 0) problems.push(`事件缺少必填项：${impactMissing.join("、")}。`);

      const rawSources = Array.isArray(impactJson.sources) ? (impactJson.sources as unknown[]) : [];
      if (rawSources.length === 0) {
        problems.push(
          "没有任何来源。每条记录至少需要一条来源（含 URL、媒体名、发布日期与原文引述）。",
        );
      }
      rawSources.forEach((item, i) => {
        const sourceJson = asJson(item);
        if (!sourceJson) {
          problems.push(`第 ${i + 1} 条来源不是对象。`);
          return;
        }
        problems.push(...unknownKeys(sourceJson, SOURCE_KEYS, `第 ${i + 1} 条来源`));
        const missing = missingFields(sourceJson, REQUIRED_SOURCE_FIELDS);
        if (missing.length > 0) problems.push(`第 ${i + 1} 条来源缺少必填项：${missing.join("、")}。`);
      });

      const label = `${slug} / ${String(impactJson.event_date ?? "日期缺失")}`;

      // Presence failures make the zod report redundant and noisier (an absent
      // key reads as "expected string, received undefined"), so stop here.
      if (problems.length > 0) {
        rejections.push({ index, label, problems });
        continue;
      }

      const parsed = recordInputSchema.safeParse(toRecordInput(entry, impactJson));

      if (!parsed.success) {
        const fields = fieldErrorsOf(parsed.error);
        problems.push(...Object.entries(fields).map(([field, message]) => `${field}: ${message}`));
        rejections.push({ index, label, problems });
        continue;
      }

      // The same publish gate the backoffice applies. Seed records land
      // published, so a record whose evidence does not carry its claimed grade
      // must be rejected here rather than published unchecked.
      const gate = checkPublishable({
        attributionConfidence: parsed.data.impact.attributionConfidence,
        counterEvidence: parsed.data.impact.counterEvidence,
        sources: parsed.data.sources,
      });
      problems.push(...gate.errors);

      const key = businessKey(
        parsed.data.company.slug,
        parsed.data.impact.eventDate,
        parsed.data.impact.impactType,
      );
      const duplicate = seenKeys.get(key);
      if (duplicate !== undefined) {
        problems.push(
          `与第 ${duplicate} 条记录的业务键重复（${key}）。导入按该键 upsert，重复会让后一条覆盖前一条。`,
        );
      }
      seenKeys.set(key, index);

      if (problems.length > 0) {
        rejections.push({ index, label, problems });
        continue;
      }

      candidates.push({ index, label, key, input: parsed.data, warnings: gate.warnings });
    }
  });

  return { candidates, rejections };
}

// ---------------------------------------------------------------------------
// Post-import reconciliation (the queries from DEPLOY.md §5)
// ---------------------------------------------------------------------------

async function report(): Promise<void> {
  const db = await getDb();

  const [[total], byStatus, byConfidence, [sourceTotal]] = await Promise.all([
    db.select({ value: count() }).from(aiImpact),
    db
      .select({ key: aiImpact.recordStatus, value: count() })
      .from(aiImpact)
      .groupBy(aiImpact.recordStatus),
    db
      .select({ key: aiImpact.attributionConfidence, value: count() })
      .from(aiImpact)
      .groupBy(aiImpact.attributionConfidence),
    db.select({ value: count() }).from(source),
  ]);

  const [[companies], [sourceless], [highWithoutFirstHand]] = await Promise.all([
    db.select({ value: count() }).from(company),
    // Must be 0. The deferred trigger should make it impossible to insert such
    // a row; this confirms the trigger actually exists in *this* database.
    db
      .select({ value: count() })
      .from(aiImpact)
      .where(sql`not exists (select 1 from ${source} where ${source.aiImpactId} = ${aiImpact.id})`),
    db
      .select({ value: count() })
      .from(aiImpact)
      .where(
        sql`${aiImpact.attributionConfidence} = 'high' and not exists (
          select 1 from ${source}
           where ${source.aiImpactId} = ${aiImpact.id}
             and ${source.sourceType} in ('primary_company', 'tier1_media'))`,
      ),
  ]);

  const line = (rows: { key: string; value: number }[]) =>
    rows
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((row) => `${row.key}=${Number(row.value)}`)
      .join("  ");

  console.log("\n[seed] 库内核对");
  console.log(`  company            ${Number(companies.value)}`);
  console.log(`  ai_impact          ${Number(total.value)}`);
  console.log(`  source             ${Number(sourceTotal.value)}`);
  console.log(`  record_status      ${line(byStatus)}`);
  console.log(`  置信度分布         ${line(byConfidence)}`);
  console.log(`  无来源记录数       ${Number(sourceless.value)}  (必须为 0)`);
  console.log(`  high 缺一手来源    ${Number(highWithoutFirstHand.value)}  (必须为 0)`);

  if (Number(sourceless.value) > 0 || Number(highWithoutFirstHand.value) > 0) {
    throw new Error("导入后核对不通过：存在无来源记录或 high 级别缺少一手/主流媒体来源。");
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const file = path.resolve(process.cwd(), process.env.SEED_FILE?.trim() || DEFAULT_SEED_FILE);

  console.log(`[seed] target: ${describeDbTarget(resolveDbTarget())}`);
  console.log(`[seed] file:   ${path.relative(process.cwd(), file)}`);
  if (dryRun) console.log("[seed] --dry-run: 只校验，不写库");

  const parsedFile: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsedFile)) {
    throw new Error("数据集顶层必须是数组（每项一家公司，含 company 与 impacts）。");
  }

  const dataset = parsedFile as Json[];
  const { candidates, rejections } = validate(dataset);

  console.log(
    `[seed] 数据集：${dataset.length} 家公司 / ${candidates.length + rejections.length} 条记录`,
  );

  if (rejections.length > 0) {
    console.error(`\n[seed] ${rejections.length} 条记录未通过校验，整批不写入：`);
    for (const item of rejections) {
      console.error(`\n  第 ${item.index} 条 — ${item.label}`);
      for (const problem of item.problems) console.error(`    - ${problem}`);
    }
    console.error(
      "\n[seed] 校验不会为了让导入跑通而放宽：请在数据集里补齐来源 URL / 原文引述等字段后重跑。",
    );
    process.exit(1);
  }

  const warned = candidates.filter((item) => item.warnings.length > 0);
  if (warned.length > 0) {
    console.log(`\n[seed] ${warned.length} 条记录有非阻塞提示（不影响导入）：`);
    for (const item of warned) {
      console.log(`  第 ${item.index} 条 — ${item.label}`);
      for (const warning of item.warnings) console.log(`    · ${warning}`);
    }
  }

  if (dryRun) {
    console.log(`\n[seed] 校验通过：${candidates.length} 条记录可导入。未写库。`);
    return;
  }

  // Existing rows keyed the same way, so a re-run updates instead of inserting.
  const db = await getDb();
  const existingRows = await db
    .select({
      id: aiImpact.id,
      slug: company.slug,
      eventDate: aiImpact.eventDate,
      impactType: aiImpact.impactType,
    })
    .from(aiImpact)
    .innerJoin(company, eq(aiImpact.companyId, company.id));

  const existing = new Map(
    existingRows.map((row) => [businessKey(row.slug, row.eventDate, row.impactType), row.id]),
  );

  let inserted = 0;
  let updated = 0;

  for (const candidate of candidates) {
    const impactId = existing.get(candidate.key);
    try {
      // One transaction per record (inside saveRecord): company + impact + all
      // its sources commit together, which the deferred "at least one source"
      // trigger requires.
      await saveRecord(candidate.input, { impactId, reviewedBy: null });
    } catch (error) {
      console.error(
        `\n[seed] 第 ${candidate.index} 条（${candidate.label}）写入失败，已写入 ${inserted + updated} 条。`,
      );
      console.error("[seed] 本脚本幂等，修掉原因后重跑即可从中断处收敛。");
      throw error;
    }
    if (impactId) updated += 1;
    else inserted += 1;
  }

  console.log(`\n[seed] 写入完成：新增 ${inserted} 条，更新 ${updated} 条，拒绝 0 条。`);
  await report();
}

main()
  .then(() => {
    // getDb caches a pool / PGlite handle that keeps the event loop alive.
    process.exit(0);
  })
  .catch((error) => {
    console.error("[seed] failed:", error);
    process.exit(1);
  });
