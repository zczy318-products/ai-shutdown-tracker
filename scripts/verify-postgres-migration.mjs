/**
 * Proves the `DATABASE_URL` path builds the schema, not just the PGlite path.
 *
 *   npm run verify:pg
 *
 * The two paths are different code: `resolveDbTarget` returns
 * `kind: "postgres"`, `src/db/migrate.ts` takes the `node-postgres` branch, and
 * `drizzle-orm/node-postgres/migrator` applies the files. None of that is
 * exercised by `npm run db:migrate` with no DATABASE_URL set, so a migration
 * that works locally could still fail on Neon.
 *
 * There is no Postgres server in this environment (no daemon, no container
 * runtime), so the server side is PGlite exposed over the real Postgres wire
 * protocol by `@electric-sql/pglite-socket`. Everything on the *client* side is
 * genuine: a TCP socket, `pg`'s startup and auth handshake, its prepared
 * statements and parameter binding, and the node-postgres migrator. PGlite is
 * Postgres compiled to WASM, so the SQL dialect is the same engine too.
 *
 * What this does not cover: provider-specific behaviour such as Neon's TLS
 * termination and pooled endpoint. Those are verified against the real database
 * the first time `DEPLOY.md` §4 runs, and `DATABASE_SSL=false` here says plainly
 * that the local hop is unencrypted.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = Number(process.env.VERIFY_PG_PORT ?? 55432);
let failures = 0;

function check(label, pass, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code, output }));
  });
}

const dir = await mkdtemp(path.join(tmpdir(), "aist-verify-pg-"));
const db = new PGlite(dir);
await db.waitReady;

const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });

try {
  await server.start();
  console.log(`serving an empty database over the Postgres wire protocol on 127.0.0.1:${PORT}\n`);

  const env = {
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
    // The hop is a loopback socket to a local process; there is no TLS to verify.
    DATABASE_SSL: "false",
    // Make sure the PGlite fallback cannot quietly take over.
    PGLITE_DATA_DIR: path.join(dir, "must-not-be-used"),
  };

  const first = await run("npx", ["tsx", "src/db/migrate.ts"], env);
  check(
    "the migrator selects the node-postgres driver",
    first.output.includes("node-postgres (DATABASE_URL)"),
    first.output.match(/\[migrate\] target: .*/)?.[0] ?? "no target line",
  );
  check(
    "migrations apply over DATABASE_URL from an empty database",
    first.code === 0 && first.output.includes("[migrate] done"),
    first.code === 0 ? "" : first.output.trim().split("\n").slice(-4).join(" | ").slice(0, 300),
  );

  const second = await run("npx", ["tsx", "src/db/migrate.ts"], env);
  check(
    "re-running the migrator over DATABASE_URL is a no-op",
    second.code === 0 && second.output.includes("[migrate] done"),
    second.code === 0 ? "" : second.output.trim().split("\n").slice(-4).join(" | ").slice(0, 300),
  );

  // Read the result back through the same wire protocol, with `pg` itself.
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: false,
  });
  await client.connect();
  try {
    const tables = await client.query(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = tables.rows.map((row) => row.table_name);
    for (const table of ["ai_impact", "company", "source", "users", "sessions"]) {
      check(`table ${table} exists over DATABASE_URL`, names.includes(table));
    }

    const enums = await client.query(
      `select typname from pg_type where typtype = 'e' order by typname`,
    );
    const enumNames = enums.rows.map((row) => row.typname);
    for (const name of [
      "attribution_confidence",
      "company_size",
      "impact_type",
      "industry",
      "link_health",
      "outcome",
      "record_status",
      "region",
      "source_type",
    ]) {
      check(`enum ${name} exists`, enumNames.includes(name));
    }

    const triggers = await client.query(
      `select tgname from pg_trigger where not tgisinternal order by tgname`,
    );
    const triggerNames = triggers.rows.map((row) => row.tgname);
    check(
      "the 'at least one source' trigger is installed",
      triggerNames.includes("ai_impact_requires_source_trigger"),
      triggerNames.join(", ") || "no triggers",
    );
    check(
      "the 'last source cannot be deleted' trigger is installed",
      triggerNames.includes("source_delete_requires_remaining_trigger"),
    );

    const partial = await client.query(
      `select indexdef from pg_indexes where indexname = 'ai_impact_one_primary_per_company'`,
    );
    check(
      "the one-primary-per-company partial unique index is installed",
      partial.rows[0]?.indexdef?.includes("WHERE is_primary") ?? false,
      partial.rows[0]?.indexdef ?? "missing",
    );

    // The trigger has to bite over this driver too, not just under PGlite's
    // in-process API — `pg` runs statements in its own transaction frame.
    await client.query("begin");
    const { rows } = await client.query(
      `insert into company (slug, name, country_code, region, industry)
       values ('pg-verify', 'PG Verify', 'US', 'north_america', 'other') returning id`,
    );
    await client.query(
      `insert into ai_impact (company_id, impact_type, attribution_confidence, outcome, event_date, summary)
       values ($1, 'replaced_by_ai_product', 'high', 'mass_layoff', '2025-10-27', $2)`,
      [
        rows[0].id,
        "据报道，该公司于 2025 年宣布大幅裁员，管理层将其归因于免费 AI 工具抢走了付费订阅用户。",
      ],
    );
    let rejected = false;
    let message = "";
    try {
      await client.query("commit");
    } catch (error) {
      rejected = true;
      message = String(error?.message ?? error).split("\n")[0];
      await client.query("rollback").catch(() => {});
    }
    check(
      "committing an unsourced record over DATABASE_URL is rejected",
      rejected && message.includes("has no source row"),
      message.slice(0, 120) || "the write was ACCEPTED",
    );
  } finally {
    await client.end().catch(() => {});
  }
} finally {
  await server.stop().catch(() => {});
  await db.close().catch(() => {});
  await rm(dir, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? "the DATABASE_URL path builds the schema" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
