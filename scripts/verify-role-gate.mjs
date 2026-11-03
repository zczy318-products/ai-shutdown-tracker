/**
 * ZCZ-15 — the /admin role gate, end to end against a real server.
 *
 *   npm run verify:roles            # override with PORT=<n>
 *
 * Self-contained: it builds its own throwaway PGlite database, seeds it, starts
 * its own server and stops it again. It never touches `.pglite`, it reads no
 * `DATABASE_URL` (the hosted database is on a paid tier, and a verification run
 * has no business spending its quota), and it refuses to run if something else
 * is already serving the port.
 *
 * What it is here to prove, in the order the task listed it:
 *
 *   0. the migration — `users.role` exists, defaults to the *least* privileged
 *      grade, and backfills every pre-existing row to that grade. Checked by
 *      migrating a database to the state before this migration, writing rows
 *      into it, and then applying the migration;
 *   1. the source, statically — the migration hardcodes no address and no
 *      promotion rule; no public page looks at a role; `can()` still takes a
 *      plan and nothing else; every /admin page calls the gate in its own body;
 *   2. a freshly registered account (a viewer) is refused by all five /admin
 *      pages, lands on /account rather than /login, and leaks no subscriber
 *      address into the body of the redirect that turns it away;
 *   3. an editor can do all of it — the gate is a gate, not a wall;
 *   4. the same five server actions, POSTed directly by that same account once
 *      it is a viewer again, change nothing in the database. A hidden button is
 *      not a gate, so the buttons are not what is being tested: the action ids
 *      are harvested while the account is an editor and replayed after it is
 *      not.
 *
 * Phases 2–4 need three different server processes, because PGlite locks its
 * data directory: granting and then revoking the role is SQL this script has to
 * run itself, and it can only do that while no server holds the lock. The
 * session cookie survives, which is the point — the role is read per request.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.PORT ?? 3117);
const BASE = `http://127.0.0.1:${PORT}`;
const SCRATCH = path.join(REPO, ".verify-roles");
const DB_DIR = path.join(SCRATCH, "pglite");
const MIGRATION_DB_DIR = path.join(SCRATCH, "pglite-migration");
const PRE_MIGRATIONS = path.join(SCRATCH, "drizzle-pre");
const MIGRATIONS = path.join(REPO, "drizzle");

const RUN = Date.now();
const EMAIL = `zcz15-${RUN}@example.com`;
const PASSWORD = "correct-horse-8";
/** A subscriber address that must never appear in a response to someone refused. */
const SUBSCRIBER = `zcz15-subscriber-${RUN}@example.com`;

let failures = 0;
let serverLog = "";

function check(label, pass, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function unescapeHtml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** React splits interpolated text with `<!-- -->`; strip it so assertions read as prose. */
function visibleText(html) {
  return html.replaceAll("<!-- -->", "");
}

async function get(pathname, cookie = "") {
  const res = await fetch(BASE + pathname, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  return { res, body: visibleText(await res.text()) };
}

async function postAction(pathname, fields, cookie = "") {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(BASE + pathname, {
    method: "POST",
    body: fd,
    redirect: "manual",
    // Next refuses to replay a server action for a POST it considers
    // cross-origin, and answers with the plain page instead of the action's
    // result — which would make every assertion below meaningless.
    headers: { origin: BASE, ...(cookie ? { cookie } : {}) },
  });
  return { res, body: visibleText(await res.text()) };
}

function cookieOf(res) {
  for (const value of res.headers.getSetCookie?.() ?? []) {
    const [pair] = value.split(";");
    if (pair.startsWith("aist_session=") && !pair.endsWith("=")) return pair;
  }
  return "";
}

/**
 * Hidden server-action fields of one rendered form.
 *
 * Addressed by content, with exclusions, rather than by index: the draft page
 * renders four forms (publish, submit-for-review, delete, and the editor) and
 * three of them carry `name="impactId"`, so "the first one" is not an address.
 */
function actionFieldsFor(html, marker, without = []) {
  const forms = html.match(/<form[\s\S]*?<\/form>/g) ?? [];
  const form = forms.find(
    (f) => f.includes(marker) && without.every((excluded) => !f.includes(excluded)),
  );
  if (!form) throw new Error(`no form containing ${marker}`);
  const fields = {};
  for (const m of form.matchAll(/<input([^>]*type="hidden"[^>]*)>/g)) {
    const name = m[1].match(/name="([^"]*)"/)?.[1];
    if (name) fields[name] = unescapeHtml(m[1].match(/value="([^"]*)"/)?.[1] ?? "");
  }
  return fields;
}

/** Where a response — a page redirect or a server action's — is sending us. */
function redirectTarget({ res, body }) {
  return (
    res.headers.get("location") ||
    res.headers.get("x-action-redirect") ||
    body.match(/"(\/(?:account|admin|login)[^"]*)"/)?.[1] ||
    ""
  );
}

// ---------------------------------------------------------------------------
// Database (PGlite only, and only while no server holds the lock)
// ---------------------------------------------------------------------------

async function openDb(dir) {
  const { PGlite } = await import("@electric-sql/pglite");
  const client = new PGlite(dir);
  await client.waitReady;
  return client;
}

async function applyMigrations(dir, folder) {
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const client = new PGlite(dir);
  await client.waitReady;
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.close();
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

function run(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: REPO,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    child.on("close", (code) => resolve({ code, output }));
  });
}

/**
 * `detached` so the whole process group can be killed: `npx next dev` is a
 * wrapper around the process that actually binds the port, and killing only the
 * wrapper leaves a server running — which would make the next phase talk to a
 * database this script thinks nobody has open.
 */
function startServer() {
  const child = spawn("npx", ["next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
    cwd: REPO,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PGLITE_DATA_DIR: DB_DIR,
      DATABASE_URL: "",
      NEXT_PUBLIC_APP_URL: "",
      VERCEL_URL: "",
    },
  });
  child.stdout.on("data", (c) => (serverLog += c));
  child.stderr.on("data", (c) => (serverLog += c));
  return child;
}

async function stopServer(child) {
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      /* already gone */
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  // PGlite keeps a lock file until the process is really gone.
  await new Promise((r) => setTimeout(r, 1200));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      const res = await fetch(BASE + "/", { redirect: "manual" });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function requirePortFree() {
  try {
    await fetch(BASE + "/", { redirect: "manual", signal: AbortSignal.timeout(2000) });
  } catch {
    return;
  }
  console.error(`something is already serving ${BASE}. Stop it, or set PORT=<other>.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fixtures for the record the editor writes
// ---------------------------------------------------------------------------

const SLUG = `role-gate-${RUN}`;
const VIEWER_SLUG = `role-gate-viewer-${RUN}`;
const SUMMARY =
  "据 CNBC 与 The Verge 等媒体报道，该公司于 2025 年宣布裁员，管理层在业绩电话会上" +
  "将订阅用户流失与营收下滑归因于免费 AI 工具以及搜索引擎的 AI 摘要抢走流量。";
const EDITOR_SUMMARY = SUMMARY + "（由 editor 账号保存，用于验证写入路径仍然可用。）";
const VIEWER_SUMMARY = SUMMARY + "（这段文字如果出现在库里，说明 viewer 写入成功了，门禁没拦住。）";

function recordFields(overrides = {}) {
  return {
    "company.slug": SLUG,
    "company.name": `Role Gate Co ${RUN}`,
    "company.nameZh": "权限验证公司",
    // Every key the rendered form posts is present, empty ones included: the
    // schema treats a *missing* key as invalid input (there is no default), so
    // a short payload would be refused for the wrong reason and prove nothing
    // about the role gate.
    "company.aliases": "Role Gate Inc\nRGC",
    "company.websiteUrl": "https://example.com",
    "company.logoUrl": "",
    "company.countryCode": "US",
    "company.industry": "education",
    "company.companySize": "large",
    "company.foundedYear": "2005",
    "company.description": "一家美国在线学习平台，主营按月订阅的习题解答服务。",
    "impact.impactType": "replaced_by_ai_product",
    "impact.attributionConfidence": "high",
    "impact.outcome": "mass_layoff",
    "impact.eventDate": "2025-10-27",
    "impact.eventDatePrecision": "day",
    "impact.summary": SUMMARY,
    // Present because the browser form always posts them, empty or not:
    // `impactInputSchema` accepts "" and null, but not a missing key.
    "impact.employeesAffected": "388",
    "impact.employeesAffectedPct": "22.00",
    "impact.counterEvidence": "部分分析认为该公司在 AI 出现前已面临订阅增长见顶。",
    "impact.revenueImpactNote": "据报道，公司股价当日下跌约 48%。",
    "impact.summaryEn": "",
    "impact.reviewNote": "",
    status: "draft",
    "sources.0.url": `https://example.com/role-gate-${RUN}`,
    "sources.0.mediaName": "CNBC",
    "sources.0.sourceType": "tier1_media",
    "sources.0.publishedAt": "2025-05-12",
    "sources.0.title": "AI shakes up education tech",
    "sources.0.author": "A Reporter",
    "sources.0.quoteTranslationZh": "",
    "sources.0.archiveUrl": "",
    "sources.0.quote":
      "The company said the rise of free generative AI tools had taken students away from its paid subscription service.",
    "sources.0.quoteLang": "en",
    "sources.0.linkHealth": "ok",
    "sources.0.manuallyVerified": "on",
    ...overrides,
  };
}

// ===========================================================================
// Phase 0 — the migration
// ===========================================================================

console.log("--- phase 0: the migration ---");

await rm(SCRATCH, { recursive: true, force: true });
await mkdir(SCRATCH, { recursive: true });

/**
 * The migrations folder as it was *before* this task's migration, built by
 * dropping the `_user_role` entry from the journal. Addressed by tag rather
 * than by index so this keeps working when ZCZ-14's 0005 lands alongside it.
 */
const journal = JSON.parse(await readFile(path.join(MIGRATIONS, "meta/_journal.json"), "utf8"));
const roleEntry = journal.entries.find((entry) => entry.tag.endsWith("_user_role"));
check("the journal has a user_role migration", Boolean(roleEntry), roleEntry?.tag ?? "none");
if (!roleEntry) {
  console.log("\ncannot verify without the migration; stopping here.");
  process.exit(1);
}

const earlier = journal.entries.filter((entry) => entry !== roleEntry);
await mkdir(path.join(PRE_MIGRATIONS, "meta"), { recursive: true });
for (const entry of earlier) {
  await cp(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(PRE_MIGRATIONS, `${entry.tag}.sql`));
}
await writeFile(
  path.join(PRE_MIGRATIONS, "meta/_journal.json"),
  JSON.stringify({ ...journal, entries: earlier }, null, 2),
);

await applyMigrations(MIGRATION_DB_DIR, PRE_MIGRATIONS);

{
  const db = await openDb(MIGRATION_DB_DIR);
  const columnBefore = await db.query(
    `select 1 from information_schema.columns where table_name = 'users' and column_name = 'role'`,
  );
  check(
    "before the migration, users has no role column",
    columnBefore.rows.length === 0,
    `${columnBefore.rows.length} row(s)`,
  );

  // Rows that look like the ones already in the hosted database: accounts that
  // existed while /admin was open to any session. None of them was ever granted
  // write access, so none of them may come out of the migration with it.
  const hasInterval = await db.query(
    `select 1 from information_schema.columns
      where table_name = 'users' and column_name = 'plan_interval'`,
  );
  const legacy = [
    ["legacy-free-a@example.com", "free"],
    ["legacy-free-b@example.com", "free"],
    ["legacy-pro@example.com", "pro"],
  ];
  for (const [email, plan] of legacy) {
    if (plan === "pro" && hasInterval.rows.length > 0) {
      await db.query(
        `insert into users (email, password_hash, plan, plan_interval) values ($1, 'x', 'pro', 'monthly')`,
        [email],
      );
    } else {
      await db.query(`insert into users (email, password_hash, plan) values ($1, 'x', $2)`, [
        email,
        plan,
      ]);
    }
  }
  check("three pre-existing accounts written at the pre-migration schema", true, `${legacy.length} rows`);
  await db.close();
}

await applyMigrations(MIGRATION_DB_DIR, MIGRATIONS);

{
  const db = await openDb(MIGRATION_DB_DIR);

  const column = await db.query(
    `select data_type, udt_name, is_nullable, column_default
       from information_schema.columns
      where table_name = 'users' and column_name = 'role'`,
  );
  const meta = column.rows.at(0);
  check("users.role exists after the migration", Boolean(meta), JSON.stringify(meta ?? null));
  check("users.role is NOT NULL", meta?.is_nullable === "NO", String(meta?.is_nullable));
  check(
    "users.role defaults to the least privileged grade",
    String(meta?.column_default ?? "").includes("'viewer'"),
    String(meta?.column_default),
  );

  const values = await db.query(
    `select e.enumlabel as value from pg_enum e
       join pg_type t on t.oid = e.enumtypid
      where t.typname = $1 order by e.enumsortorder`,
    [meta?.udt_name ?? "user_role"],
  );
  const labels = values.rows.map((row) => row.value);
  check(
    "the role enum is exactly viewer / editor",
    labels.length === 2 && labels.includes("viewer") && labels.includes("editor"),
    labels.join(", "),
  );

  const graded = await db.query(`select email, role, plan from users order by email`);
  const promoted = graded.rows.filter((row) => row.role !== "viewer");
  check(
    "every pre-existing account landed on the least privileged grade",
    graded.rows.length === 3 && promoted.length === 0,
    promoted.length
      ? `promoted: ${promoted.map((r) => `${r.email}=${r.role}`).join(", ")}`
      : graded.rows.map((r) => `${r.plan}:${r.role}`).join(" "),
  );
  check(
    "the pro account did not get write access out of its plan",
    graded.rows.find((row) => row.plan === "pro")?.role === "viewer",
    `pro → ${graded.rows.find((row) => row.plan === "pro")?.role}`,
  );

  // Re-applying has to be a no-op, not a second ALTER.
  await db.close();
}
await applyMigrations(MIGRATION_DB_DIR, MIGRATIONS);
{
  const db = await openDb(MIGRATION_DB_DIR);
  const rows = await db.query(`select count(*)::int as n from users where role = 'editor'`);
  check("re-running the migrator changes nothing and grants nobody", rows.rows[0].n === 0);
  await db.close();
}

// ===========================================================================
// Phase 1 — what the source says, read statically
// ===========================================================================

console.log("\n--- phase 1: the source ---");

const sqlText = await readFile(path.join(MIGRATIONS, `${roleEntry.tag}.sql`), "utf8");
const sqlStatements = sqlText
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

check(
  "the migration's executable SQL names no email address",
  !/@/.test(sqlStatements),
  sqlStatements.match(/.*@.*/)?.[0] ?? "none",
);
check(
  "the migration defaults the column to viewer, never to editor",
  /default\s+'viewer'/i.test(sqlStatements) && !/default\s+'editor'/i.test(sqlStatements),
);
check(
  "the migration contains no promotion statement at all",
  !/update\s+"?users"?\s+set/i.test(sqlStatements),
  sqlStatements.match(/update[^\n]*/i)?.[0] ?? "none",
);
check(
  "'editor' appears in the migration only as an enum value",
  (sqlStatements.match(/editor/gi) ?? []).length === 1 &&
    /create type[^\n]*'viewer',\s*'editor'/i.test(sqlStatements),
);

/** 浏览不需要账号：no public page may look at a role. */
const PUBLIC_SOURCES = [
  "src/app/(public)/layout.tsx",
  "src/app/(public)/page.tsx",
  "src/app/(public)/company/[slug]/page.tsx",
  "src/app/(public)/stats/page.tsx",
  "src/app/pricing/page.tsx",
  "src/app/subscribe/confirm/page.tsx",
  "src/app/subscribe/unsubscribe/page.tsx",
];
for (const file of PUBLIC_SOURCES) {
  const source = await readFile(path.join(REPO, file), "utf8").catch(() => null);
  if (source === null) {
    check(`public page ${file} exists`, false, "not found — update this list");
    continue;
  }
  // Looking for a role *check*, not for the string "role": these pages are
  // full of `role="status"` and `role="alert"`, which is ARIA markup and has
  // nothing to do with permissions.
  const hits = [
    ...source.matchAll(/requireEditor|isEditor|labelOfRole|landingPathFor|ROLE_DENIED_PATH|lib\/roles|\.role\b/g),
  ].map((m) => m[0]);
  check(`${file} contains no role check`, hits.length === 0, hits.join(", "));
}

/** `plan` and `role` stay separate: `can()` must not learn about roles. */
const plans = await readFile(path.join(REPO, "src/lib/plans.ts"), "utf8");
check(
  "can() takes a plan and an entitlement, and nothing else",
  /export function can\(plan: Plan, entitlement: Entitlement\): boolean/.test(plans),
  plans.match(/export function can\([^)]*\)/)?.[0] ?? "not found",
);
check("src/lib/plans.ts mentions no role at all", !/\brole\b/i.test(plans));
const roles = await readFile(path.join(REPO, "src/lib/roles.ts"), "utf8");
check(
  "src/lib/roles.ts derives nothing from a plan",
  !/\bplan\b/.test(roles.replace(/^\s*\*.*$/gm, "").replace(/\/\/.*$/gm, "")),
);

/** Every /admin page gates in its own body, not only in the layout. */
const ADMIN_PAGES = [
  "src/app/admin/layout.tsx",
  "src/app/admin/page.tsx",
  "src/app/admin/records/page.tsx",
  "src/app/admin/records/[id]/page.tsx",
  "src/app/admin/records/new/page.tsx",
  "src/app/admin/subscribers/page.tsx",
];
for (const file of ADMIN_PAGES) {
  const source = await readFile(path.join(REPO, file), "utf8");
  check(
    `${file} calls requireEditor() in its own body`,
    /await requireEditor\(\)/.test(source) && !/await requireUser\(\)/.test(source),
  );
}

const actionsSource = await readFile(path.join(REPO, "src/app/admin/records/actions.ts"), "utf8");
for (const action of [
  "createRecord",
  "updateRecord",
  "publishRecord",
  "changeRecordStatus",
  "deleteRecord",
]) {
  check(
    `${action} is exported from the one file that writes records`,
    new RegExp(`export async function ${action}\\(`).test(actionsSource),
  );
}
check(
  "the write actions gate on the role, and no longer settle for a session",
  (actionsSource.match(/await requireEditor\(\)/g) ?? []).length === 4 &&
    !/requireUser|getCurrentUser/.test(actionsSource),
  `${(actionsSource.match(/await requireEditor\(\)/g) ?? []).length} call(s) — ` +
    "saveFromForm covers createRecord and updateRecord",
);

// ===========================================================================
// Phase 2 — a freshly registered account
// ===========================================================================

console.log("\n--- phase 2: a self-service registration (viewer) ---");

await requirePortFree();
await applyMigrations(DB_DIR, MIGRATIONS);
const seeded = await run("npx", ["tsx", "src/db/seed.ts"], {
  PGLITE_DATA_DIR: DB_DIR,
  DATABASE_URL: "",
});
check("the throwaway database seeds", seeded.code === 0, seeded.output.trim().split("\n").at(-1));

let publishedSlug = "";
let publishedTotal = 0;
{
  const db = await openDb(DB_DIR);
  // One pending subscriber, so "no address in that response body" is a claim
  // about an address that actually exists in this database.
  await db.query(
    `insert into subscriber (email, status, confirm_token_hash, confirm_token_expires_at,
                             unsub_token_hash, source)
     values ($1, 'pending', $2, now() + interval '7 days', $3, 'verify-roles')`,
    [SUBSCRIBER, sha256(`confirm-${RUN}`), sha256(`unsub-${RUN}`)],
  );
  const row = await db.query(
    `select c.slug as slug from ai_impact i join company c on c.id = i.company_id
      where i.record_status = 'published' limit 1`,
  );
  publishedSlug = row.rows.at(0)?.slug ?? "";
  const total = await db.query(
    `select count(*)::int as n from ai_impact where record_status = 'published'`,
  );
  publishedTotal = total.rows[0].n;
  await db.close();
}
check(
  "the fixture has a published record and a subscriber to protect",
  Boolean(publishedSlug) && publishedTotal > 0,
  `${publishedTotal} published · /company/${publishedSlug}`,
);

const ADMIN_PATHS = () => [
  "/admin",
  "/admin/records",
  "/admin/records/new",
  `/admin/records/${draftId || randomUUID()}`,
  "/admin/subscribers",
];

let viewerCookie = "";
let draftId = "";

let server = startServer();
try {
  if (!(await waitForServer())) {
    console.error(`server did not start on ${BASE}\n${serverLog.slice(-3000)}`);
    process.exit(1);
  }

  // Anonymous first: unchanged behaviour, and the leak PR #3 closed must stay
  // closed.
  for (const pathname of ADMIN_PATHS()) {
    const r = await get(pathname);
    const location = r.res.headers.get("location") ?? "";
    check(
      `anonymous ${pathname} is turned away to /login`,
      [302, 303, 307].includes(r.res.status) && location.includes("/login"),
      `HTTP ${r.res.status} → ${location || "(none)"}`,
    );
    check(
      `anonymous ${pathname} leaks no subscriber address in the redirect body`,
      !r.body.includes(SUBSCRIBER),
      `${r.body.length}B`,
    );
  }

  // Register. This is the hole: /register is open to anyone, by product
  // decision — accounts are the subscription subject — so what the new account
  // *may do* is the only thing standing between a stranger and the data.
  {
    const page = await get("/register");
    const r = await postAction("/register", {
      ...actionFieldsFor(page.body, 'name="email"'),
      email: EMAIL,
      password: PASSWORD,
    });
    viewerCookie = cookieOf(r.res);
    const target = redirectTarget(r);
    check("registering issues a session", viewerCookie.startsWith("aist_session="), target);
    check(
      "POST /register lands on /account, not /admin",
      target.startsWith("/account"),
      target || "(no redirect)",
    );
  }

  {
    const r = await get("/account", viewerCookie);
    const role = r.body.match(/data-role="([a-z]*)"/)?.[1] ?? "";
    check("the new account is a viewer", role === "viewer", role || "no data-role on /account");
    check(
      "/account does not advertise a backoffice the account cannot enter",
      !r.body.includes('href="/admin"'),
    );
  }

  for (const pathname of ADMIN_PATHS()) {
    const r = await get(pathname, viewerCookie);
    const location = r.res.headers.get("location") ?? "";
    check(
      `viewer ${pathname} is refused`,
      [302, 303, 307].includes(r.res.status) && location.startsWith("/account"),
      `HTTP ${r.res.status} → ${location || "(none)"}`,
    );
    check(
      `viewer ${pathname} is not bounced to /login`,
      !location.includes("/login"),
      location || "(none)",
    );
    check(
      `viewer ${pathname} leaks no subscriber address in the redirect body`,
      !r.body.includes(SUBSCRIBER),
      `${r.body.length}B`,
    );
    check(
      `viewer ${pathname} renders no record editor into the redirect body`,
      !r.body.includes('name="company.slug"'),
    );
  }

  {
    const r = await get("/account?denied=admin", viewerCookie);
    check(
      "/account explains the refusal instead of leaving it unexplained",
      r.res.status === 200 && r.body.includes('data-denied="admin"') && r.body.includes("没有录入权限"),
      `HTTP ${r.res.status}`,
    );
    check(
      "and says the refusal is not about money",
      r.body.includes("和付费套餐无关"),
    );
  }

  // 浏览不需要账号 — with no cookie at all, and with a viewer cookie, the
  // public pages are the same pages.
  for (const pathname of ["/", `/company/${publishedSlug}`, "/stats", "/pricing", "/subscribe/confirm"]) {
    const anonymous = await get(pathname);
    check(
      `anonymous ${pathname} renders`,
      anonymous.res.status === 200,
      `HTTP ${anonymous.res.status}`,
    );
    const signedIn = await get(pathname, viewerCookie);
    check(
      `${pathname} does not change for a signed-in viewer`,
      signedIn.res.status === 200,
      `HTTP ${signedIn.res.status}`,
    );
  }
  {
    const home = await get("/");
    const shown = Number(home.body.match(/data-result-total="(\d+)"/)?.[1] ?? NaN);
    check(
      "the anonymous listing still shows every published record",
      shown === publishedTotal,
      `${shown} shown · ${publishedTotal} published`,
    );
    const detail = await get(`/company/${publishedSlug}`);
    check(
      "and a detail page still carries its sources and quotes",
      detail.body.includes("来源") && /https?:\/\//.test(detail.body),
    );
    // The public header must not invite a signed-in account into /admin: it is
    // not allowed to look at a role, so it cannot know who would be refused.
    const asViewer = await get("/", viewerCookie);
    check(
      "the public header offers no /admin link to a signed-in account",
      !asViewer.body.includes('href="/admin"'),
      asViewer.body.match(/href="\/admin[^"]*"/)?.[0] ?? "none",
    );
  }

  // Last, because it ends the session: a viewer has to be able to sign out.
  // Before ZCZ-15 the only logout form lived in the /admin layout, which is
  // precisely the page a viewer can no longer open.
  {
    const page = await get("/account", viewerCookie);
    const r = await postAction("/account", actionFieldsFor(page.body, "登出"), viewerCookie);
    const target = redirectTarget(r);
    check("a viewer can sign out from /account", target.startsWith("/login"), target || "(none)");
    const after = await get("/account", viewerCookie);
    check(
      "and the session is really gone",
      (after.res.headers.get("location") ?? "").includes("/login"),
      `HTTP ${after.res.status} → ${after.res.headers.get("location")}`,
    );
  }
} finally {
  await stopServer(server);
}

// ===========================================================================
// Phase 3 — the same account, granted the editor role out of band
// ===========================================================================

console.log("\n--- phase 3: the same account, granted editor ---");

{
  const db = await openDb(DB_DIR);
  // Exactly the statement docs/ROLE_GATE.md tells a human to run. Nothing in
  // the application can do this.
  const granted = await db.query(`update users set role = 'editor' where email = $1 returning role`, [
    EMAIL,
  ]);
  check("one explicit UPDATE grants the role", granted.rows.at(0)?.role === "editor");
  await db.close();
}

let actionIds = {};
let editorCookie = "";

server = startServer();
try {
  if (!(await waitForServer())) {
    console.error(`server did not restart on ${BASE}\n${serverLog.slice(-3000)}`);
    process.exit(1);
  }

  {
    const page = await get("/login");
    const r = await postAction("/login", {
      ...actionFieldsFor(page.body, 'name="email"'),
      email: EMAIL,
      password: PASSWORD,
    });
    editorCookie = cookieOf(r.res) || viewerCookie;
    const target = redirectTarget(r);
    check("an editor signing in lands on /admin", target.startsWith("/admin"), target || "(none)");
  }

  for (const pathname of ["/admin", "/admin/records", "/admin/records/new", "/admin/subscribers"]) {
    const r = await get(pathname, editorCookie);
    check(`editor ${pathname} renders`, r.res.status === 200, `HTTP ${r.res.status}`);
  }
  {
    const r = await get("/admin/subscribers", editorCookie);
    check(
      "the editor's subscriber view does show the address",
      r.body.includes(SUBSCRIBER),
      "the same address every refused response above withheld",
    );
  }

  // createRecord, for real: the gate has to let the work through.
  {
    const page = await get("/admin/records/new", editorCookie);
    actionIds.createRecord = actionFieldsFor(page.body, 'name="company.slug"');
    const r = await postAction(
      "/admin/records/new",
      { ...actionIds.createRecord, ...recordFields() },
      editorCookie,
    );
    draftId =
      redirectTarget(r).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ??
      "";
    check("an editor can create a record", Boolean(draftId), draftId || r.body.slice(0, 200));
  }
  if (!draftId) {
    console.error("no draft to work with; the rest of the run would prove nothing.");
    await stopServer(server);
    process.exit(1);
  }

  // The remaining four action ids, harvested from the draft's page while this
  // account still has the role. Phase 4 replays them without it.
  {
    const page = await get(`/admin/records/${draftId}`, editorCookie);
    check(`editor /admin/records/${draftId.slice(0, 8)}… renders`, page.res.status === 200);
    actionIds.updateRecord = actionFieldsFor(page.body, 'name="company.slug"');
    // The publish form is the one with an impactId and no target status.
    actionIds.publishRecord = actionFieldsFor(page.body, 'name="impactId"', [
      'name="nextStatus"',
      'name="company.slug"',
      "删除草稿",
    ]);
    actionIds.changeRecordStatus = actionFieldsFor(page.body, 'value="in_review"');
    actionIds.deleteRecord = actionFieldsFor(page.body, "删除草稿");
    // React names the hidden handle `$ACTION_REF_<n>` for an action wrapped in
    // `useActionState` (all five are) and `$ACTION_ID_<hash>` for a bare one.
    // Both are "the address of a server action", which is what phase 4 needs.
    const handleOf = (fields) =>
      Object.keys(fields).find((key) => key.startsWith("$ACTION_REF") || key.startsWith("$ACTION_ID"));
    const harvested = Object.entries(actionIds).filter(([, fields]) => handleOf(fields));
    const handles = new Set(harvested.map(([, fields]) => handleOf(fields)));
    check(
      "all five action handles harvested from the rendered forms",
      harvested.length === 5,
      harvested.map(([name, fields]) => `${name}→${handleOf(fields)}`).join(" "),
    );
    check(
      "and they are five different actions, not one form found five times",
      handles.size === 5,
      [...handles].join(" "),
    );
  }

  // And an editor write that is not a create, so both halves of `saveFromForm`
  // are known to work before phase 4 claims they are refused.
  {
    const r = await postAction(
      `/admin/records/${draftId}`,
      {
        ...actionIds.updateRecord,
        ...recordFields({ "impact.summary": EDITOR_SUMMARY }),
        impactId: draftId,
      },
      editorCookie,
    );
    check(
      "an editor can update a record",
      !r.body.includes('role="alert"'),
      r.body.match(/role="alert"[\s\S]{0,200}/)?.[0]?.replace(/<[^>]+>/g, " ") ?? "no error",
    );
  }
} finally {
  await stopServer(server);
}

let before = {};
{
  const db = await openDb(DB_DIR);
  const row = await db.query(
    `select i.record_status as status, i.summary as summary,
            (select count(*)::int from company) as companies,
            (select count(*)::int from ai_impact) as impacts
       from ai_impact i where i.id = $1`,
    [draftId],
  );
  before = row.rows.at(0) ?? {};
  check(
    "the editor's record is on file as a draft before the replay",
    before.status === "draft" && before.summary === EDITOR_SUMMARY,
    `${before.status} · ${before.companies} companies / ${before.impacts} records`,
  );
  const revoked = await db.query(`update users set role = 'viewer' where email = $1 returning role`, [
    EMAIL,
  ]);
  check("the role is revoked again for the replay", revoked.rows.at(0)?.role === "viewer");
  await db.close();
}

// ===========================================================================
// Phase 4 — the five write actions, POSTed by a viewer and by a stranger
// ===========================================================================

console.log("\n--- phase 4: the five write actions, replayed without the role ---");

server = startServer();
try {
  if (!(await waitForServer())) {
    console.error(`server did not restart on ${BASE}\n${serverLog.slice(-3000)}`);
    process.exit(1);
  }

  {
    const r = await get("/account", editorCookie);
    check(
      "the session survived the revocation and is a viewer again",
      r.body.match(/data-role="([a-z]*)"/)?.[1] === "viewer",
      r.body.match(/data-role="([a-z]*)"/)?.[1] ?? "no data-role",
    );
  }

  const replays = [
    {
      name: "createRecord",
      pathname: "/admin/records/new",
      fields: () => ({
        ...actionIds.createRecord,
        ...recordFields({ "company.slug": VIEWER_SLUG, "company.name": `Viewer Co ${RUN}` }),
      }),
    },
    {
      name: "updateRecord",
      pathname: `/admin/records/${draftId}`,
      fields: () => ({
        ...actionIds.updateRecord,
        ...recordFields({ "impact.summary": VIEWER_SUMMARY }),
        impactId: draftId,
      }),
    },
    {
      name: "publishRecord",
      pathname: `/admin/records/${draftId}`,
      fields: () => ({ ...actionIds.publishRecord, impactId: draftId }),
    },
    {
      name: "changeRecordStatus",
      pathname: `/admin/records/${draftId}`,
      fields: () => ({ ...actionIds.changeRecordStatus, impactId: draftId, nextStatus: "in_review" }),
    },
    {
      name: "deleteRecord",
      pathname: `/admin/records/${draftId}`,
      fields: () => ({ ...actionIds.deleteRecord, impactId: draftId }),
    },
  ];

  for (const replay of replays) {
    const asViewer = await postAction(replay.pathname, replay.fields(), editorCookie);
    const target = redirectTarget(asViewer);
    check(
      `a viewer POSTing ${replay.name} directly is refused`,
      target.startsWith("/account") && !target.startsWith("/admin"),
      `HTTP ${asViewer.res.status} → ${target || "(no redirect)"}`,
    );
    const asStranger = await postAction(replay.pathname, replay.fields());
    const strangerTarget = redirectTarget(asStranger);
    check(
      `an anonymous POST of ${replay.name} is refused`,
      strangerTarget.startsWith("/login"),
      `HTTP ${asStranger.res.status} → ${strangerTarget || "(no redirect)"}`,
    );
  }
} finally {
  await stopServer(server);
}

// ===========================================================================
// Phase 5 — what the database says after all that
// ===========================================================================

console.log("\n--- phase 5: the database, server stopped ---");

{
  const db = await openDb(DB_DIR);

  const row = await db.query(`select record_status as status, summary from ai_impact where id = $1`, [
    draftId,
  ]);
  const after = row.rows.at(0);
  check("the record the viewer tried to delete is still there", Boolean(after));
  check(
    "publishRecord and changeRecordStatus did not move it",
    after?.status === "draft",
    String(after?.status),
  );
  check(
    "updateRecord did not rewrite its summary",
    after?.summary === EDITOR_SUMMARY,
    after?.summary === VIEWER_SUMMARY ? "the viewer's text is in the database" : "unchanged",
  );

  const created = await db.query(`select id from company where slug = $1`, [VIEWER_SLUG]);
  check("createRecord created nothing", created.rows.length === 0, `${created.rows.length} row(s)`);

  const totals = await db.query(
    `select (select count(*)::int from company) as companies,
            (select count(*)::int from ai_impact) as impacts`,
  );
  check(
    "no row count moved while the role was revoked",
    totals.rows[0].companies === before.companies && totals.rows[0].impacts === before.impacts,
    `${totals.rows[0].companies}/${totals.rows[0].impacts} vs ${before.companies}/${before.impacts}`,
  );

  const graded = await db.query(`select role, count(*)::int as n from users group by role`);
  check(
    "no account granted itself anything along the way",
    graded.rows.every((r) => r.role === "viewer"),
    graded.rows.map((r) => `${r.role}=${r.n}`).join(" "),
  );

  await db.close();
}

console.log(
  failures === 0
    ? "\nALL CHECKS PASSED — /admin is behind the editor role, and the five write actions are too"
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
