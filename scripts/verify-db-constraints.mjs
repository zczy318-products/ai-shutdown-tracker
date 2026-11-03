/**
 * Layer 3 of the source guarantee: proves the *database* refuses an unsourced
 * or incompletely sourced record, with no application code in the way.
 *
 *   npm run verify:db
 *
 * Runs the real migrations from `drizzle/` against a throwaway PGlite database,
 * then issues raw SQL. Nothing here imports the app, so a passing run means the
 * constraints hold even against a direct `psql` session, a seed script, or a
 * future endpoint that forgets to validate.
 *
 * Also doubles as the "migration runs clean from an empty database" check, and
 * runs the migrator twice to show it is idempotent.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

let failures = 0;

function check(label, pass, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

/** Runs `fn` and reports whether the database refused it, and why. */
async function expectRejected(label, expectedFragment, fn) {
  try {
    await fn();
    check(label, false, "the write was ACCEPTED");
  } catch (error) {
    const message = String(error?.message ?? error).split("\n")[0];
    check(label, message.includes(expectedFragment), message.slice(0, 140));
  }
}

async function expectAccepted(label, fn) {
  try {
    await fn();
    check(label, true);
  } catch (error) {
    check(label, false, String(error?.message ?? error).split("\n")[0].slice(0, 140));
  }
}

const dir = await mkdtemp(path.join(tmpdir(), "aist-verify-db-"));
const client = new PGlite(dir);

try {
  await client.waitReady;

  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  check("migrations apply to an empty database", true);
  await migrate(db, { migrationsFolder: "drizzle" });
  check("migrations are idempotent (second run is a no-op)", true);

  const tables = await client.query(
    `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
  );
  const names = tables.rows.map((row) => row.table_name);
  for (const table of ["company", "ai_impact", "source", "users", "sessions"]) {
    check(`table ${table} exists`, names.includes(table));
  }

  const SUMMARY =
    "据 CNBC 等媒体报道，该公司于 2025 年宣布大幅裁员，管理层将订阅用户流失归因于免费 AI 工具的竞争。";
  const QUOTE =
    "The company said the rise of free AI tools had taken users away from its subscription service.";

  const { rows: companyRows } = await client.query(
    `insert into company (slug, name, country_code, region, industry)
     values ('verify-co', 'Verify Co', 'US', 'north_america', 'education')
     returning id`,
  );
  const companyId = companyRows[0].id;

  const insertImpact = (status = "draft") =>
    client.query(
      `insert into ai_impact
         (company_id, impact_type, attribution_confidence, outcome, event_date, summary, record_status)
       values ($1, 'replaced_by_ai_product', 'high', 'mass_layoff', '2025-10-27', $2, $3)
       returning id`,
      [companyId, SUMMARY, status],
    );

  const insertSource = (impactId, overrides = {}) => {
    const values = {
      url: "https://example.com/a",
      media_name: "CNBC",
      source_type: "tier1_media",
      published_at: "2025-05-12",
      quote: QUOTE,
      ...overrides,
    };
    return client.query(
      `insert into source (ai_impact_id, url, media_name, source_type, published_at, quote)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        impactId,
        values.url,
        values.media_name,
        values.source_type,
        values.published_at,
        values.quote,
      ],
    );
  };

  console.log("\n-- 每条记录至少一条来源 (deferred constraint trigger) --");

  // The trigger fires at COMMIT, so the assertion has to be a whole transaction.
  await expectRejected(
    "committing an ai_impact with no source is rejected",
    "has no source row",
    async () => {
      await client.exec("begin");
      try {
        await insertImpact();
        await client.exec("commit");
      } catch (error) {
        await client.exec("rollback").catch(() => {});
        throw error;
      }
    },
  );

  let impactId;
  await expectAccepted("an ai_impact plus one source in one transaction is accepted", async () => {
    await client.exec("begin");
    try {
      const { rows } = await insertImpact();
      impactId = rows[0].id;
      await insertSource(impactId);
      await client.exec("commit");
    } catch (error) {
      await client.exec("rollback").catch(() => {});
      throw error;
    }
  });

  await expectRejected(
    "deleting the only source of a record is rejected",
    "would be left with no source row",
    async () => {
      await client.exec("begin");
      try {
        await client.query(`delete from source where ai_impact_id = $1`, [impactId]);
        await client.exec("commit");
      } catch (error) {
        await client.exec("rollback").catch(() => {});
        throw error;
      }
    },
  );

  await expectAccepted("deleting a record cascades its sources away", async () => {
    await client.exec("begin");
    try {
      const { rows } = await insertImpact();
      const spare = rows[0].id;
      await insertSource(spare, { url: "https://example.com/spare" });
      await client.exec("commit");
      await client.exec("begin");
      await client.query(`delete from ai_impact where id = $1`, [spare]);
      await client.exec("commit");
    } catch (error) {
      await client.exec("rollback").catch(() => {});
      throw error;
    }
  });

  console.log("\n-- 来源四项必填 + quote 规范 --");

  await expectRejected("a source with a NULL quote is rejected", "null value", () =>
    client.query(
      `insert into source (ai_impact_id, url, media_name, source_type, published_at, quote)
       values ($1, 'https://example.com/null-quote', 'CNBC', 'tier1_media', '2025-05-12', null)`,
      [impactId],
    ),
  );
  await expectRejected("a source with an empty quote is rejected", "source_quote_length_check", () =>
    insertSource(impactId, { url: "https://example.com/empty-quote", quote: "" }),
  );
  await expectRejected(
    "a source with a 19-character quote is rejected",
    "source_quote_length_check",
    () => insertSource(impactId, { url: "https://example.com/short", quote: "x".repeat(19) }),
  );
  await expectRejected("a source with a NULL url is rejected", "null value", () =>
    client.query(
      `insert into source (ai_impact_id, url, media_name, source_type, published_at, quote)
       values ($1, null, 'CNBC', 'tier1_media', '2025-05-12', $2)`,
      [impactId, QUOTE],
    ),
  );
  await expectRejected("a non-http url is rejected", "source_url_format", () =>
    insertSource(impactId, { url: "ftp://example.com/x" }),
  );
  await expectRejected("a blank media_name is rejected", "source_media_name_not_blank", () =>
    insertSource(impactId, { url: "https://example.com/blank-media", media_name: "   " }),
  );
  await expectRejected("a NULL published_at is rejected", "null value", () =>
    client.query(
      `insert into source (ai_impact_id, url, media_name, source_type, published_at, quote)
       values ($1, 'https://example.com/no-date', 'CNBC', 'tier1_media', null, $2)`,
      [impactId, QUOTE],
    ),
  );
  await expectRejected(
    "the same url twice under one record is rejected",
    "source_impact_url_unique",
    () => insertSource(impactId),
  );

  console.log("\n-- 归因字段必须显式给出 --");

  await expectRejected("an ai_impact with no attribution_confidence is rejected", "null value", () =>
    client.query(
      `insert into ai_impact (company_id, impact_type, outcome, event_date, summary)
       values ($1, 'replaced_by_ai_product', 'mass_layoff', '2025-10-27', $2)`,
      [companyId, SUMMARY],
    ),
  );
  await expectRejected("an ai_impact with no impact_type is rejected", "null value", () =>
    client.query(
      `insert into ai_impact (company_id, attribution_confidence, outcome, event_date, summary)
       values ($1, 'high', 'mass_layoff', '2025-10-27', $2)`,
      [companyId, SUMMARY],
    ),
  );
  await expectRejected(
    "an attribution_confidence outside the enum is rejected",
    "invalid input value for enum",
    () =>
      client.query(
        `insert into ai_impact (company_id, impact_type, attribution_confidence, outcome, event_date, summary)
         values ($1, 'replaced_by_ai_product', 'very_high', 'mass_layoff', '2025-10-27', $2)`,
        [companyId, SUMMARY],
      ),
  );

  console.log("\n-- 其他结构约束 --");

  await expectRejected(
    "a second primary event for one company is rejected",
    "ai_impact_one_primary_per_company",
    async () => {
      await client.exec("begin");
      try {
        for (const n of [1, 2]) {
          const { rows } = await insertImpact();
          await client.query(`update ai_impact set is_primary = true where id = $1`, [rows[0].id]);
          await insertSource(rows[0].id, { url: `https://example.com/primary-${n}` });
        }
        await client.exec("commit");
      } catch (error) {
        await client.exec("rollback").catch(() => {});
        throw error;
      }
    },
  );
  await expectRejected("an invalid slug is rejected", "company_slug_format", () =>
    client.query(
      `insert into company (slug, name, country_code, region, industry)
       values ('Not A Slug', 'X', 'US', 'north_america', 'other')`,
    ),
  );
  await expectRejected("a too-short summary is rejected", "ai_impact_summary_length_check", () =>
    client.query(
      `insert into ai_impact (company_id, impact_type, attribution_confidence, outcome, event_date, summary)
       values ($1, 'replaced_by_ai_product', 'high', 'mass_layoff', '2025-10-27', '太短')`,
      [companyId],
    ),
  );
  await expectRejected(
    "a negative employees_affected is rejected",
    "ai_impact_employees_affected_check",
    () =>
      client.query(
        `insert into ai_impact
           (company_id, impact_type, attribution_confidence, outcome, event_date, summary, employees_affected)
         values ($1, 'replaced_by_ai_product', 'high', 'mass_layoff', '2025-10-27', $2, -1)`,
        [companyId, SUMMARY],
      ),
  );
} finally {
  await client.close().catch(() => {});
  await rm(dir, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? "all database constraint checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
