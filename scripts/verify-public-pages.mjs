/**
 * Acceptance check for the public front end (T5 / ZCZ-6).
 *
 *   npm run build            # the script serves the production build
 *   npm run verify:public
 *
 * Self-contained, unlike `verify:auth` / `verify:records`: it builds its own
 * throwaway PGlite database in `.pglite-public-check`, imports `seed/
 * companies.json` through the real `npm run db:seed`, starts `next start`
 * against it on its own port, and tears everything down afterwards. Nothing
 * touches the `.pglite` directory the dev server uses.
 *
 * The expected numbers are **computed from the seed JSON here**, independently
 * of the queries under test, so a count is only "correct" when the page and the
 * dataset agree. Printing them is the point: the ZCZ-6 completion criteria ask
 * for measured filter combinations with result counts, and this is where they
 * come from.
 *
 * One record is deliberately flipped to `archived` before the server starts.
 * That is the only way to prove the visibility rule rather than assert it: a
 * non-published row exists in the same database, and every public surface has
 * to behave as if it does not.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";

const PORT = Number(process.env.PORT ?? 3111);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_DIR = process.env.PGLITE_DATA_DIR ?? ".pglite-public-check";
const SEED_FILE = process.env.SEED_FILE ?? "seed/companies.json";
const PAGE_SIZE = 12; // PUBLIC_PAGE_SIZE in src/lib/records/public.ts

let failures = 0;
let checks = 0;

function check(label, pass, detail = "") {
  checks++;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function eq(label, actual, expected) {
  check(label, actual === expected, `got ${actual}, expected ${expected}`);
}

// ---------------------------------------------------------------------------
// Expected values, derived from the dataset rather than from the app
// ---------------------------------------------------------------------------

const seed = JSON.parse(await readFile(SEED_FILE, "utf8"));

/** One flat row per ai_impact, which is the unit the listing paginates. */
const all = seed.flatMap((entry) =>
  entry.impacts.map((impact) => ({
    slug: entry.company.slug,
    name: entry.company.name,
    nameZh: entry.company.name_zh,
    aliases: entry.company.aliases ?? [],
    country: entry.company.country_code,
    region: entry.company.region,
    industry: entry.company.industry,
    eventDate: impact.event_date,
    year: Number(impact.event_date.slice(0, 4)),
    impactType: impact.impact_type,
    confidence: impact.attribution_confidence,
    outcome: impact.outcome,
    sources: impact.sources,
  })),
);

/**
 * The record taken out of circulation: a company with exactly one event, so
 * archiving it also removes its company page. Chosen deterministically (last
 * slug alphabetically) so a re-run archives the same one.
 */
const singleEventSlugs = [...new Set(all.map((r) => r.slug))].filter(
  (slug) => all.filter((r) => r.slug === slug).length === 1,
);
const ARCHIVED_SLUG = singleEventSlugs.sort().at(-1);
const archived = all.find((r) => r.slug === ARCHIVED_SLUG);

/** What the public site must see: everything except the archived record. */
const live = all.filter((r) => r.slug !== ARCHIVED_SLUG);

const tally = (rows, pick) =>
  rows.reduce((acc, row) => acc.set(pick(row), (acc.get(pick(row)) ?? 0) + 1), new Map());

const matches = (filters) =>
  live.filter((row) =>
    Object.entries(filters).every(([field, value]) => {
      if (field === "q") {
        const needle = value.toLowerCase();
        return (
          row.name.toLowerCase().includes(needle) ||
          (row.nameZh ?? "").toLowerCase().includes(needle) ||
          row.slug.includes(needle) ||
          row.aliases.some((alias) => alias.toLowerCase().includes(needle))
        );
      }
      return row[field] === value;
    }),
  ).length;

// ---------------------------------------------------------------------------
// HTTP + HTML helpers
// ---------------------------------------------------------------------------

/**
 * What a reader (or a `curl`) actually gets.
 *
 * Two transforms, both load-bearing for the assertions below:
 *  - React splits interpolated text with `<!-- -->` so it can hydrate it;
 *  - the RSC flight payload inside `<script>` tags repeats the whole tree as
 *    escaped strings, so every `data-*` attribute and every quote appears
 *    twice. Counting without stripping it reports double. Removing scripts also
 *    makes the "quote is on the page" checks mean the *rendered* page.
 */
const visible = (html) =>
  html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replaceAll("<!-- -->", "");

const unescapeHtml = (s) =>
  s
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

async function get(path) {
  const res = await fetch(BASE + path, { redirect: "manual" });
  return { status: res.status, html: visible(await res.text()) };
}

const attrs = (html, name) =>
  [...html.matchAll(new RegExp(`data-${name}="([^"]*)"`, "g"))].map((m) => m[1]);

const attr = (html, name) => attrs(html, name).at(0);

const num = (html, name) => Number(attr(html, name));

/** `data-row-key` / `data-row-value` pairs, in document order. */
function pairs(html, keyName, valueName) {
  const re = new RegExp(`data-${keyName}="([^"]*)"\\s+data-${valueName}="([^"]*)"`, "g");
  return new Map([...html.matchAll(re)].map((m) => [m[1], Number(m[2])]));
}

// ---------------------------------------------------------------------------
// Fixture: migrate, seed, archive one record
// ---------------------------------------------------------------------------

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${command} exited ${code}\n${out}`)),
    );
  });
}

if (!existsSync(".next/BUILD_ID")) {
  console.error("no production build found. Run `npm run build` first.");
  process.exit(1);
}

console.log(`seed file:   ${SEED_FILE} (${seed.length} companies / ${all.length} records)`);
console.log(`database:    ${DB_DIR} (throwaway)`);
console.log(`archived:    ${ARCHIVED_SLUG} — must be invisible everywhere\n`);

await rm(DB_DIR, { recursive: true, force: true });
const dbEnv = { PGLITE_DATA_DIR: DB_DIR, DATABASE_URL: "" };
await run("npx", ["tsx", "src/db/migrate.ts"], dbEnv);
await run("npx", ["tsx", "src/db/seed.ts"], dbEnv);

{
  const { PGlite } = await import("@electric-sql/pglite");
  const client = new PGlite(DB_DIR);
  await client.waitReady;
  const result = await client.query(
    `update ai_impact set record_status = 'archived'
       where company_id = (select id from company where slug = $1)
       returning id`,
    [ARCHIVED_SLUG],
  );
  eq("fixture: one record flipped to archived", result.rows.length, 1);
  await client.close();
}

/**
 * One server per database directory; the empty-data phase gets its own.
 *
 * `detached` matters more than it looks: `npx next start` is a wrapper around
 * the process that actually binds the port, so killing the wrapper leaves the
 * server running. A later run would then silently talk to the *previous* run's
 * database and pass — which is how this was found. Its own process group means
 * `stopServer` can take the whole tree down.
 */
function startServer(dataDir) {
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: {
      ...process.env,
      PGLITE_DATA_DIR: dataDir,
      // `next start` forces NODE_ENV=production, which refuses PGlite unless
      // this opt-in is set. A throwaway local database is exactly what it is for.
      PGLITE_ALLOW_PRODUCTION: "true",
      DATABASE_URL: "",
    },
  });
  child.log = "";
  child.stdout.on("data", (chunk) => (child.log += chunk));
  child.stderr.on("data", (chunk) => (child.log += chunk));
  return child;
}

async function stopServer(child) {
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      /* already gone */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // PGlite holds a lock on its data directory; give the port and the lock a
  // moment before the next phase claims it.
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * Refuses to run against a server this script did not start. Without this, a
 * leftover process on the port makes the whole run meaningless.
 */
async function requirePortFree() {
  try {
    await fetch(BASE + "/", { redirect: "manual", signal: AbortSignal.timeout(2000) });
  } catch {
    return;
  }
  console.error(`something is already serving ${BASE}. Stop it, or set PORT=<other>.`);
  process.exit(1);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(BASE + "/", { redirect: "manual" });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Phase 0: an empty (but migrated) database
// ---------------------------------------------------------------------------
//
// A completion criterion in its own right: before any data exists, the three
// pages must render an empty state rather than an error. This is also the state
// of a fresh deployment between `db:migrate` and the first import, so it is the
// first thing a visitor could possibly see.

await requirePortFree();

const EMPTY_DIR = `${DB_DIR}-empty`;
await rm(EMPTY_DIR, { recursive: true, force: true });
await run("npx", ["tsx", "src/db/migrate.ts"], { PGLITE_DATA_DIR: EMPTY_DIR, DATABASE_URL: "" });

{
  console.log("\n--- 空数据库（迁移完成、尚未导入）---");
  const empty = startServer(EMPTY_DIR);
  try {
    if (!(await waitForServer())) {
      console.error(`server did not start on ${BASE}\n${empty.log}`);
      process.exit(1);
    }
    const home = await get("/");
    eq("空库 GET / is 200", home.status, 200);
    eq("空库榜单条数", num(home.html, "result-total"), 0);
    check("空库榜单给出空状态而不是报错", home.html.includes("还没有已发布的记录"));
    const stats = await get("/stats");
    eq("空库 GET /stats is 200", stats.status, 200);
    check("空库仪表盘给出空状态而不是报错", stats.html.includes("暂无可统计数据"));
    const filtered = await get("/?confidence=high&year=2025");
    eq("空库带筛选参数仍是 200", filtered.status, 200);
    const missing = await get("/company/anything");
    eq("空库公司页 404", missing.status, 404);
  } finally {
    await stopServer(empty);
    if (!process.env.KEEP_DB) await rm(EMPTY_DIR, { recursive: true, force: true });
  }
}

const server = startServer(DB_DIR);

try {
  if (!(await waitForServer())) {
    console.error(`server did not start on ${BASE}\n${server.log}`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // 1. Listing: visibility, counts, pagination, sorting
  // -------------------------------------------------------------------------
  console.log("\n--- 榜单页 / ---");
  const home = await get("/");
  eq("GET / is 200", home.status, 200);
  eq("首页默认展示语义表格", (home.html.match(/<table\b/g) ?? []).length, 1);
  eq("事件表有六个列标题", (home.html.match(/scope="col"/g) ?? []).length, 6);
  check("表格滚动区域有可访问名称并可键盘聚焦", /class="archive-table-scroll"[^>]*role="region"[^>]*aria-label="[^"]+"[^>]*tabindex="0"/.test(home.html));
  check("首页保留来源与反证入口", home.html.includes("#sources-") && home.html.includes("有反方证据"));
  check("不将自动发布描述为人工核验", !home.html.includes("公开报道的人工标注") && !home.html.includes("人工评出置信度"));
  eq("已发布记录总数", num(home.html, "result-total"), live.length);
  eq("第 1 页事件行数", attrs(home.html, "record-id").length, PAGE_SIZE);
  eq("总页数", num(home.html, "result-pages"), Math.ceil(live.length / PAGE_SIZE));
  check(
    "置信度标签在榜单可见",
    (home.html.match(/归因置信度/g) ?? []).length >= PAGE_SIZE,
    `${(home.html.match(/归因置信度/g) ?? []).length} 次`,
  );

  const seen = new Set();
  const pageCount = Math.ceil(live.length / PAGE_SIZE);
  for (let page = 1; page <= pageCount; page++) {
    const { html } = await get(`/?page=${page}`);
    const ids = attrs(html, "record-id");
    const expected = Math.min(PAGE_SIZE, live.length - (page - 1) * PAGE_SIZE);
    eq(`第 ${page} 页事件行数`, ids.length, expected);
    for (const id of ids) seen.add(id);
  }
  eq("三页合计去重后条数", seen.size, live.length);

  const clamped = await get("/?page=99");
  eq("page=99 收敛到最后一页", num(clamped.html, "result-page"), pageCount);

  // -------------------------------------------------------------------------
  // 2. Filters, measured one combination at a time
  // -------------------------------------------------------------------------
  console.log("\n--- 筛选组合（实测条数）---");
  const combos = [
    ["（无筛选）", "", {}],
    ["confidence=high", "?confidence=high", { confidence: "high" }],
    ["confidence=medium", "?confidence=medium", { confidence: "medium" }],
    ["confidence=low", "?confidence=low", { confidence: "low" }],
    [
      "impactType=ai_cost_cutting_layoff",
      "?impactType=ai_cost_cutting_layoff",
      { impactType: "ai_cost_cutting_layoff" },
    ],
    [
      "impactType=replaced_by_ai_product",
      "?impactType=replaced_by_ai_product",
      { impactType: "replaced_by_ai_product" },
    ],
    ["impactType=voluntary_pivot", "?impactType=voluntary_pivot", { impactType: "voluntary_pivot" }],
    [
      "impactType=mentioned_in_coverage",
      "?impactType=mentioned_in_coverage",
      { impactType: "mentioned_in_coverage" },
    ],
    ["year=2025", "?year=2025", { year: 2025 }],
    ["year=2023", "?year=2023", { year: 2023 }],
    ["industry=software_saas", "?industry=software_saas", { industry: "software_saas" }],
    ["industry=it_services", "?industry=it_services", { industry: "it_services" }],
    ["country=US", "?country=US", { country: "US" }],
    ["country=GB", "?country=GB", { country: "GB" }],
    ["q=chegg", "?q=chegg", { q: "chegg" }],
    ["year=2025 + confidence=high", "?year=2025&confidence=high", { year: 2025, confidence: "high" }],
    [
      "industry=software_saas + impactType=ai_cost_cutting_layoff",
      "?industry=software_saas&impactType=ai_cost_cutting_layoff",
      { industry: "software_saas", impactType: "ai_cost_cutting_layoff" },
    ],
    [
      "country=US + year=2025 + confidence=medium",
      "?country=US&year=2025&confidence=medium",
      { country: "US", year: 2025, confidence: "medium" },
    ],
    [
      "五项全开（指向单条记录）",
      `?q=${archivedFreeSample().slug}&year=${archivedFreeSample().year}&industry=${archivedFreeSample().industry}&country=${archivedFreeSample().country}&impactType=${archivedFreeSample().impactType}&confidence=${archivedFreeSample().confidence}`,
      {
        q: archivedFreeSample().slug,
        year: archivedFreeSample().year,
        industry: archivedFreeSample().industry,
        country: archivedFreeSample().country,
        impactType: archivedFreeSample().impactType,
        confidence: archivedFreeSample().confidence,
      },
    ],
  ];

  for (const [label, query, filters] of combos) {
    const { status, html } = await get(`/${query}`);
    const expected = matches(filters);
    const actual = num(html, "result-total");
    const cards = attrs(html, "record-id").length;
    check(
      `${label} → ${actual} 条`,
      status === 200 && actual === expected && cards === Math.min(expected, PAGE_SIZE),
      `expected ${expected}, cards ${cards}, status ${status}`,
    );
  }

  const bogus = await get("/?industry=bogus&confidence=nope&year=abcd&country=qq&sort=hack&page=-1");
  check(
    "无法识别的筛选参数被忽略而不是报错",
    bogus.status === 200 && num(bogus.html, "result-total") === live.length,
    `status ${bogus.status}, total ${num(bogus.html, "result-total")}`,
  );

  // -------------------------------------------------------------------------
  // 3. Sorting and URL round-trip
  // -------------------------------------------------------------------------
  console.log("\n--- 排序 / URL 状态 ---");
  const firstDate = async (query) => attr((await get(query)).html, "event-date");
  const firstSlug = async (query) => attr((await get(query)).html, "company-slug");

  eq(
    "sort=date_desc 首条是最新事件",
    await firstDate("/?sort=date_desc"),
    [...live].sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0].eventDate,
  );
  eq(
    "sort=date_asc 首条是最早事件",
    await firstDate("/?sort=date_asc"),
    [...live].sort((a, b) => a.eventDate.localeCompare(b.eventDate))[0].eventDate,
  );
  eq(
    "sort=name_asc 首条是公司名最小者",
    await firstSlug("/?sort=name_asc"),
    [...live].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))[0].slug,
  );
  eq(
    "sort=name_desc 首条是公司名最大者",
    await firstSlug("/?sort=name_desc"),
    [...live].sort((a, b) => b.name.toLowerCase().localeCompare(a.name.toLowerCase()))[0].slug,
  );

  // Needs a filter that still spans more than one page, so the "next page"
  // link exists at all; picked from the data rather than hard-coded.
  const bigCountry = [...tally(live, (r) => r.country)]
    .sort((a, b) => b[1] - a[1])
    .find(([, value]) => value > PAGE_SIZE)?.[0];
  if (bigCountry) {
    const paged = await get(`/?country=${bigCountry}&sort=name_asc`);
    check(
      "分页链接保留筛选与排序条件",
      paged.html.includes(`country=${bigCountry}&amp;sort=name_asc&amp;page=2`),
      `下一页链接应带 country=${bigCountry} / sort / page`,
    );
  } else {
    check("分页链接保留筛选与排序条件", true, "数据量不足一页以上，跳过");
  }

  // -------------------------------------------------------------------------
  // 4. Only published records are reachable
  // -------------------------------------------------------------------------
  console.log("\n--- 可见性（published 之外一律不可见）---");
  const everyPage = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => get(`/?page=${i + 1}`)),
  );
  const slugsOnSite = new Set(everyPage.flatMap(({ html }) => attrs(html, "company-slug")));
  check(
    `已下架记录 ${ARCHIVED_SLUG} 不出现在榜单任何一页`,
    !slugsOnSite.has(ARCHIVED_SLUG),
    [...slugsOnSite].length + " 个 slug 在榜单上",
  );
  const archivedPage = await get(`/company/${ARCHIVED_SLUG}`);
  eq(`已下架公司 /company/${ARCHIVED_SLUG} 返回 404`, archivedPage.status, 404);
  const unknown = await get("/company/this-company-does-not-exist");
  eq("未知 slug 返回 404", unknown.status, 404);

  // -------------------------------------------------------------------------
  // 5. Company pages: every source, in full
  // -------------------------------------------------------------------------
  console.log("\n--- 公司详情页（全部来源）---");
  const liveSlugs = [...new Set(live.map((row) => row.slug))];
  let renderedSources = 0;
  let missingQuotes = 0;
  let missingUrls = 0;
  let badStatus = 0;

  for (const slug of liveSlugs) {
    const { status, html } = await get(`/company/${slug}`);
    if (status !== 200) {
      badStatus++;
      continue;
    }
    const text = unescapeHtml(html);
    const expectedSources = live
      .filter((row) => row.slug === slug)
      .flatMap((row) => row.sources);
    renderedSources += attrs(html, "source-id").length;
    eq(`${slug} 人工核验提示只来自明确标记`, (html.match(/已人工打开核对/g) ?? []).length,
      expectedSources.filter((item) => item.manually_verified === true).length);

    if (attrs(html, "source-id").length !== expectedSources.length) {
      check(`${slug} 来源条数`, false, `${attrs(html, "source-id").length} / ${expectedSources.length}`);
    }
    for (const item of expectedSources) {
      if (!text.includes(item.quote)) missingQuotes++;
      if (!text.includes(item.url)) missingUrls++;
      if (!text.includes(item.media_name)) missingQuotes++;
    }
  }

  eq("所有公司详情页均 200", badStatus, 0);
  eq(
    "详情页渲染的来源条数 = 数据集条数（无截断）",
    renderedSources,
    live.reduce((sum, row) => sum + row.sources.length, 0),
  );
  eq("逐字引述 / 媒体名缺失数", missingQuotes, 0);
  eq("原文链接缺失数", missingUrls, 0);

  const multi = [...new Set(all.map((r) => r.slug))].find(
    (slug) => all.filter((r) => r.slug === slug).length > 1,
  );
  if (multi) {
    const { html } = await get(`/company/${multi}`);
    eq(
      `多事件公司 ${multi} 的时间线事件数`,
      attrs(html, "impact-id").length,
      all.filter((r) => r.slug === multi).length,
    );
  }

  const sampleSlug = liveSlugs[0];
  const sample = await get(`/company/${sampleSlug}`);
  check("详情页展示置信度标签", sample.html.includes("归因置信度"), sampleSlug);
  check(
    "详情页来源区块标注为引述他人",
    sample.html.includes("归属于各自媒体，不代表本站结论"),
    sampleSlug,
  );

  // -------------------------------------------------------------------------
  // 6. Dashboard
  // -------------------------------------------------------------------------
  console.log("\n--- 统计仪表盘 /stats ---");
  const stats = await get("/stats");
  eq("GET /stats is 200", stats.status, 200);
  check("统计页不一概声称人工标注或评级", !stats.html.includes("公开报道的人工标注") && !stats.html.includes("人工评级"));
  const tiles = pairs(stats.html, "stat-name", "stat-value");
  eq("记录数", tiles.get("records"), live.length);
  eq("公司数", tiles.get("companies"), liveSlugs.length);
  eq(
    "来源数",
    tiles.get("sources"),
    live.reduce((sum, row) => sum + row.sources.length, 0),
  );

  const bars = pairs(stats.html, "bar-key", "bar-value");
  for (const [key, expected] of tally(live, (r) => r.confidence)) {
    eq(`置信度分布 ${key}`, bars.get(key), expected);
  }
  for (const [key, expected] of tally(live, (r) => r.impactType)) {
    eq(`影响类型 ${key}`, bars.get(key), expected);
  }
  for (const [key, expected] of tally(live, (r) => r.region)) {
    eq(`地区 ${key}`, bars.get(key), expected);
  }
  for (const [key, expected] of tally(live, (r) => String(r.year))) {
    eq(`年度 ${key}`, bars.get(key), expected);
  }

  // Ties are broken by the enum's *declaration* order, because Postgres sorts
  // an enum column that way rather than alphabetically — five industries share
  // a count of 1 here, so the eighth slot is decided by this. The order is read
  // out of `src/lib/enums.ts` rather than copied, so it cannot drift.
  const enumsFile = await readFile("src/lib/enums.ts", "utf8");
  const industryOrder = [
    ...enumsFile
      .slice(enumsFile.indexOf("export const INDUSTRY = {"))
      .split("} as const")[0]
      .matchAll(/^\s{2}(\w+):/gm),
  ].map((m) => m[1]);
  check("读到行业枚举顺序", industryOrder.length === 21, `${industryOrder.length} 个取值`);

  const industries = [...tally(live, (r) => r.industry)].sort(
    (a, b) => b[1] - a[1] || industryOrder.indexOf(a[0]) - industryOrder.indexOf(b[0]),
  );
  const top = industries.slice(0, 8);
  const rest = industries.slice(8).reduce((sum, [, value]) => sum + value, 0);
  for (const [key, expected] of top) eq(`行业 ${key}（前 8）`, bars.get(key), expected);
  eq("行业「其他」合并条数", bars.get("__rest__") ?? 0, rest);

  check(
    "仪表盘标明统计口径与免责声明",
    stats.html.includes("只统计已发布记录") && stats.html.includes("不构成对任何公司的结论"),
  );

  const table = await get("/stats?view=table");
  eq("表格视图 200", table.status, 200);
  const rows = pairs(table.html, "row-key", "row-value");
  for (const [key, expected] of tally(live, (r) => r.confidence)) {
    eq(`表格视图 置信度 ${key}`, rows.get(key), expected);
  }
  for (const [key, expected] of tally(live, (r) => r.impactType)) {
    eq(`表格视图 影响类型 ${key}`, rows.get(key), expected);
  }
  check("表格视图与图表读同一组数字", [...rows.keys()].length >= [...bars.keys()].length - 1);

  // -------------------------------------------------------------------------
  // 7. The design spec's colour rule, checked mechanically
  // -------------------------------------------------------------------------
  console.log("\n--- 设计规范：颜色一律走 token ---");
  // Scoped to what design spec §7 scopes it to — «页面和图表». The backoffice
  // keeps emerald/amber for workflow states (spec rule 2 reserves status colour
  // for exactly that), and `globals.css` is where the tokens are *defined*.
  const sources = await run("git", [
    "ls-files",
    "src/app/(public)",
    "src/components/public",
    "src/components/charts",
  ]);
  const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border|fill|stroke)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
  const offenders = [];
  for (const file of sources.split("\n").filter(Boolean)) {
    if (!/\.(tsx?|css)$/.test(file) || !existsSync(file)) continue;
    const body = await readFile(file, "utf8");
    for (const [index, line] of body.split("\n").entries()) {
      if (literal.test(line)) offenders.push(`${file}:${index + 1}`);
    }
  }
  check("公开页面与图表没有颜色字面量", offenders.length === 0, offenders.join(", ") || "零命中");
  check(
    "公开页面没有引用后台状态色徽章（success / warning / destructive）",
    !/variant="(success|warning|destructive)"/.test(
      (
        await Promise.all(
          sources
            .split("\n")
            .filter((file) => /\.tsx$/.test(file) && existsSync(file))
            .map((file) => readFile(file, "utf8")),
        )
      ).join("\n"),
    ),
  );
} finally {
  await stopServer(server);
  if (!process.env.KEEP_DB) await rm(DB_DIR, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}

/**
 * A record that survives the archiving, used for the "all five filters at once"
 * case. Picked by hand-free rule: the first live record whose company has a
 * single event, so the five-way filter resolves to exactly one row.
 */
function archivedFreeSample() {
  return live.find((row) => live.filter((r) => r.slug === row.slug).length === 1);
}
