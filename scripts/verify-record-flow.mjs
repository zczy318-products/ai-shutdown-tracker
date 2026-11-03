/**
 * End-to-end check of the admin record flow against a running server:
 * entering a record with two sources and publishing it, and the failure paths
 * that must be refused with a reason.
 *
 *   npm run dev                       # or: npm run build && npm start
 *   npm run verify:records            # override with BASE_URL=http://host:port
 *
 * Like `verify-auth-flow.mjs`, it drives the real HTTP endpoints rather than
 * importing the server actions: React renders hidden `$ACTION_*` fields so the
 * forms submit without JavaScript, which is what lets plain fetch post them.
 * That matters for the failure paths in particular — posting straight to the
 * action bypasses the browser's `required` attributes, which is exactly the
 * "someone skipped the form" case the server layer has to refuse on its own.
 *
 * Each run uses a fresh throwaway account and a unique company slug, so it is
 * safe to re-run against the same database.
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const RUN = Date.now();
let cookie = "";
let failures = 0;

function unescapeHtml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function captureCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    cookie =
      /expires=thu, 01 jan 1970/i.test(c) || /max-age=0/i.test(c) || value === ""
        ? ""
        : `${name}=${value}`;
  }
}

/**
 * React separates adjacent text nodes with `<!-- -->` so it can hydrate them,
 * which splits any rendered string that interpolates a value — `已存来源（2
 * 条）` arrives as `已存来源（<!-- -->2<!-- --> 条）`. Strip the markers so an
 * assertion can be written as the text a human sees.
 */
function visibleText(html) {
  return html.replaceAll("<!-- -->", "");
}

async function get(path) {
  const res = await fetch(BASE + path, { redirect: "manual", headers: cookie ? { cookie } : {} });
  captureCookies(res);
  return { res, body: visibleText(await res.text()) };
}

/**
 * Hidden server-action fields for the form containing `marker`. Addressed by
 * content rather than by index, because the admin layout renders a logout form
 * above every page and the list page renders a filter form too.
 */
function actionFieldsFor(html, marker) {
  const form = (html.match(/<form[\s\S]*?<\/form>/g) ?? []).find((f) => f.includes(marker));
  if (!form) throw new Error(`no form containing ${marker}`);
  const fields = {};
  for (const m of form.matchAll(/<input([^>]*type="hidden"[^>]*)>/g)) {
    const name = m[1].match(/name="([^"]*)"/)?.[1];
    if (name) fields[name] = unescapeHtml(m[1].match(/value="([^"]*)"/)?.[1] ?? "");
  }
  return fields;
}

async function postAction(path, fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  const res = await fetch(BASE + path, {
    method: "POST",
    body: fd,
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  captureCookies(res);
  return { res, body: visibleText(await res.text()) };
}

function check(label, pass, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

/** The record id Next redirected to after a successful create. */
function createdRecordId({ res, body }) {
  const target =
    res.headers.get("location") ||
    res.headers.get("x-action-redirect") ||
    body.match(/\/admin\/records\/[0-9a-f-]{36}/)?.[0] ||
    "";
  return target.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? "";
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLUG = `verify-co-${RUN}`;
const COMPANY_NAME = `Verify Co ${RUN}`;

const SUMMARY =
  "据 CNBC 与 The Verge 等媒体报道，该公司于 2025 年宣布裁员，管理层在业绩电话会上" +
  "将订阅用户流失与营收下滑归因于免费 AI 工具以及搜索引擎的 AI 摘要抢走流量。";

const QUOTE_A =
  "The company said the rise of free generative AI tools had taken students away from its " +
  "paid subscription service.";
const QUOTE_B =
  "We are seeing a significant impact from AI on our traffic, the chief executive told analysts " +
  "on the earnings call.";

/** The company + impact half of the form; sources are added per case. */
function baseFields(overrides = {}) {
  return {
    "company.slug": SLUG,
    "company.name": COMPANY_NAME,
    "company.nameZh": "验证公司",
    "company.aliases": "Verify Inc\nVRFY",
    "company.countryCode": "US",
    "company.industry": "education",
    "company.companySize": "large",
    "company.foundedYear": "2005",
    "company.websiteUrl": "https://example.com",
    "company.description": "一家美国在线学习平台，主营按月订阅的习题解答服务。",
    "impact.impactType": "replaced_by_ai_product",
    "impact.attributionConfidence": "high",
    "impact.outcome": "mass_layoff",
    "impact.eventDate": "2025-10-27",
    "impact.eventDatePrecision": "day",
    "impact.summary": SUMMARY,
    "impact.employeesAffected": "388",
    "impact.employeesAffectedPct": "22.00",
    "impact.revenueImpactNote": "据报道，公司股价当日下跌约 48%。",
    "impact.counterEvidence": "部分分析认为该公司在 AI 出现前已面临订阅增长见顶。",
    status: "draft",
    ...overrides,
  };
}

function sourceFields(index, overrides = {}) {
  const defaults = {
    url: `https://example.com/report-${RUN}-${index}`,
    mediaName: index === 0 ? "CNBC" : "The Verge",
    sourceType: index === 0 ? "tier1_media" : "trade_media",
    publishedAt: "2025-05-12",
    title: "AI shakes up education tech",
    author: "A Reporter",
    quote: index === 0 ? QUOTE_A : QUOTE_B,
    quoteLang: "en",
    linkHealth: "ok",
    manuallyVerified: "on",
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [`sources.${index}.${key}`, value]),
  );
}

// ---------------------------------------------------------------------------
// 0. A session, because every record action is behind the auth gate.
// ---------------------------------------------------------------------------
{
  const { body } = await get("/register");
  await postAction("/register", {
    ...actionFieldsFor(body, 'name="email"'),
    email: `t3-${RUN}@example.com`,
    password: "correct-horse-8",
  });
  check("signed in for the record flow", cookie.startsWith("aist_session="));
}

// `new` renders the editor; its action fields are reused by every POST below.
const newPage = await get("/admin/records/new");
check("/admin/records/new renders the editor", newPage.res.status === 200, `status=${newPage.res.status}`);
const createFields = actionFieldsFor(newPage.body, 'name="company.slug"');

// ---------------------------------------------------------------------------
// 1. 失败路径 A — 无来源
// ---------------------------------------------------------------------------
console.log("\n-- 失败路径 A：保存无来源的记录 --");
{
  const r = await postAction("/admin/records/new", { ...createFields, ...baseFields() });
  const refused = !createdRecordId(r);
  const reason = r.body.includes("每条记录至少需要一条来源");
  check("a record with zero sources is refused", refused);
  check("the refusal names the reason", reason, reason ? "每条记录至少需要一条来源…否则无法保存" : "no reason in response");
}

// ---------------------------------------------------------------------------
// 2. 失败路径 B — 来源缺 quote
// ---------------------------------------------------------------------------
console.log("\n-- 失败路径 B：来源缺原文引述 (quote) --");
{
  const r = await postAction("/admin/records/new", {
    ...createFields,
    ...baseFields(),
    ...sourceFields(0, { quote: "" }),
  });
  const refused = !createdRecordId(r);
  const reason = r.body.includes("原文引述至少 20 个字符");
  check("a source with an empty quote is refused", refused);
  check("the refusal names the field", reason, reason ? "原文引述至少 20 个字符…" : "no reason in response");
}
{
  // A placeholder short enough to be meaningless is the realistic version of
  // this mistake, not a literally empty field.
  const r = await postAction("/admin/records/new", {
    ...createFields,
    ...baseFields(),
    ...sourceFields(0, { quote: "AI" }),
  });
  check(
    "a two-character placeholder quote is refused",
    !createdRecordId(r) && r.body.includes("原文引述至少 20 个字符"),
  );
}

// ---------------------------------------------------------------------------
// 3. 失败路径 C — 置信度「高」但只有聚合来源（数据字典 §3 规则 2）
// ---------------------------------------------------------------------------
console.log("\n-- 失败路径 C：评「高」但没有一手 / 主流媒体来源 --");
{
  const r = await postAction("/admin/records/new", {
    ...createFields,
    ...baseFields({ status: "published" }),
    ...sourceFields(0, { sourceType: "aggregator", mediaName: "Layoff Tracker" }),
  });
  const reason = r.body.includes("至少需要一条「公司一手材料」或「主流媒体原创报道」");
  check("publishing a 'high' grade on aggregator-only evidence is refused", !createdRecordId(r));
  check("the refusal explains what to do", reason, reason ? "补一手来源，或把置信度下调为「中」" : "no reason");
}

// ---------------------------------------------------------------------------
// 4. 失败路径 D — 所有来源都已失效
// ---------------------------------------------------------------------------
console.log("\n-- 失败路径 D：所有来源链接都已失效 --");
{
  const r = await postAction("/admin/records/new", {
    ...createFields,
    ...baseFields({ status: "published" }),
    ...sourceFields(0, { linkHealth: "dead" }),
  });
  check(
    "publishing with only dead links is refused",
    !createdRecordId(r) && r.body.includes("所有来源的链接状态都是「失效」"),
  );
}

// ---------------------------------------------------------------------------
// 5. 失败路径 E — 反爬来源未人工核验
// ---------------------------------------------------------------------------
console.log("\n-- 失败路径 E：反爬来源未勾选人工核验 --");
{
  const fields = { ...createFields, ...baseFields({ status: "published" }), ...sourceFields(0, { linkHealth: "bot_blocked" }) };
  delete fields["sources.0.manuallyVerified"];
  const r = await postAction("/admin/records/new", fields);
  check(
    "publishing a bot-blocked source without manual verification is refused",
    !createdRecordId(r) && r.body.includes("必须勾选「已人工在浏览器中确认可访问」"),
  );
}

// ---------------------------------------------------------------------------
// 6. 成功路径 — 2 条来源，录入并发布
// ---------------------------------------------------------------------------
console.log("\n-- 成功路径：录入含 2 条来源的记录并发布 --");
let recordId = "";
{
  const r = await postAction("/admin/records/new", {
    ...createFields,
    ...baseFields({ status: "published" }),
    ...sourceFields(0),
    ...sourceFields(1),
  });
  recordId = createdRecordId(r);
  check("a complete record with 2 sources is accepted", Boolean(recordId), recordId || "no redirect");
}

if (recordId) {
  const page = await get(`/admin/records/${recordId}`);
  check("the saved record is readable", page.res.status === 200, `status=${page.res.status}`);
  check("it is published", page.body.includes("已发布"));
  check("both sources were stored", page.body.includes("已存来源（2 条）"));
  check("the first verbatim quote is stored intact", page.body.includes(QUOTE_A.slice(0, 60)));
  check("the second verbatim quote is stored intact", page.body.includes(QUOTE_B.slice(0, 60)));
  check("the attribution grade is shown", page.body.includes("归因 高"));

  // Publishing re-verifies rather than trusting the stored status, so an
  // already published record reports no blockers.
  check(
    "no publish blockers remain",
    !page.body.includes("这条记录还不能发布"),
    page.body.includes("这条记录还不能发布") ? "blockers still reported" : "",
  );
}

// ---------------------------------------------------------------------------
// 7. 列表筛选与分页
// ---------------------------------------------------------------------------
console.log("\n-- 列表：筛选 --");
{
  const all = await get("/admin/records");
  check("the record appears in the list", all.body.includes(COMPANY_NAME));

  const published = await get("/admin/records?status=published");
  check("status=published includes it", published.body.includes(COMPANY_NAME));

  const drafts = await get("/admin/records?status=draft");
  check("status=draft excludes it", !drafts.body.includes(COMPANY_NAME));

  const hit = await get(`/admin/records?q=${encodeURIComponent(SLUG)}`);
  check("keyword search by slug finds it", hit.body.includes(COMPANY_NAME));

  const miss = await get("/admin/records?q=definitely-not-a-company-xyz");
  check("a non-matching keyword returns nothing", !miss.body.includes(COMPANY_NAME));

  const alias = await get("/admin/records?q=vrfy");
  check("keyword search matches an alias", alias.body.includes(COMPANY_NAME));
}

// ---------------------------------------------------------------------------
// 8. 未发布的记录不出现在公开前台
// ---------------------------------------------------------------------------
console.log("\n-- 公开前台只显示已发布记录 --");
let draftId = "";
{
  // Checked anonymously: a draft must be invisible to a visitor, not merely
  // hidden from the logged-in editor's own view of the public page.
  const published = await get("/");
  check("a published record is visible on the public page", published.body.includes(COMPANY_NAME));

  const r = await postAction("/admin/records/new", {
    ...createFields,
    ...baseFields({
      "company.slug": `${SLUG}-draft`,
      "company.name": `Draft Only ${RUN}`,
      status: "draft",
    }),
    ...sourceFields(0, { url: `https://example.com/draft-${RUN}` }),
  });
  draftId = createdRecordId(r);
  check("a draft record saves", Boolean(draftId), draftId || "no redirect");

  const saved = cookie;
  cookie = "";
  const anon = await get("/");
  check("the draft is not on the public page", !anon.body.includes(`Draft Only ${RUN}`));
  check("the published record still is", anon.body.includes(COMPANY_NAME));
  cookie = saved;
}

console.log("\n-- 下架：记录从前台撤下 --");
if (recordId) {
  const page = await get(`/admin/records/${recordId}`);
  const r = await postAction(`/admin/records/${recordId}`, {
    ...actionFieldsFor(page.body, 'name="nextStatus" value="archived"'),
    impactId: recordId,
    nextStatus: "archived",
  });
  check("archiving succeeds", r.res.status < 400, `status=${r.res.status}`);

  const after = await get(`/admin/records/${recordId}`);
  check("the record is now archived", after.body.includes("已下架"));
  check("the row and its sources are still on file", after.body.includes("已存来源（2 条）"));

  const archived = await get("/admin/records?status=archived");
  check("it moved to the archived filter", archived.body.includes(COMPANY_NAME));

  const saved = cookie;
  cookie = "";
  const anon = await get("/");
  check("the archived record is gone from the public page", !anon.body.includes(COMPANY_NAME));
  cookie = saved;
}

// ---------------------------------------------------------------------------
// 8b. 删除：只允许删草稿
// ---------------------------------------------------------------------------
console.log("\n-- 删除：仅限草稿 --");
if (draftId) {
  const page = await get(`/admin/records/${draftId}`);
  const r = await postAction(`/admin/records/${draftId}`, {
    ...actionFieldsFor(page.body, "删除草稿"),
    impactId: draftId,
  });
  check("deleting a draft succeeds", r.res.status < 400, `status=${r.res.status}`);
  const after = await get(`/admin/records/${draftId}`);
  check("the deleted draft is gone", after.res.status === 404, `status=${after.res.status}`);
}
if (recordId) {
  // The archived record is not a draft, so the same action must refuse it.
  const page = await get(`/admin/records/${recordId}`);
  const hasDeleteButton = page.body.includes("删除草稿");
  check("a non-draft record offers no delete button", !hasDeleteButton);
}

// ---------------------------------------------------------------------------
// 9. 未登录不能写
// ---------------------------------------------------------------------------
console.log("\n-- 鉴权 --");
{
  const saved = cookie;
  cookie = "";
  const r = await postAction("/admin/records/new", {
    ...createFields,
    ...baseFields(),
    ...sourceFields(0),
  });
  const redirected =
    (r.res.headers.get("location") ?? "").includes("/login") ||
    (r.res.headers.get("x-action-redirect") ?? "").includes("/login") ||
    r.body.includes("/login");
  check("an anonymous POST to the record action is refused", redirected, `status=${r.res.status}`);

  // Reads, too — and not only the status code. A layout that calls `redirect()`
  // does not stop the page under it from rendering, so the 307 turning an
  // anonymous visitor away used to carry the rendered backoffice list in its
  // body. Every /admin page that reads anything now calls `requireUser()`
  // itself; this is what holds that line.
  const list = await get("/admin/records");
  check(
    "an anonymous GET of the backoffice list is redirected",
    [302, 303, 307].includes(list.res.status) &&
      (list.res.headers.get("location") ?? "").includes("/login"),
    `status=${list.res.status} → ${list.res.headers.get("location")}`,
  );
  check(
    "and that redirect leaks no record content in its body",
    !list.body.includes(SLUG) && !list.body.includes(COMPANY_NAME),
    `${list.body.length}B, looked for ${SLUG} / ${COMPANY_NAME}`,
  );
  cookie = saved;
}

console.log(`\n${failures === 0 ? "all record flow checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
