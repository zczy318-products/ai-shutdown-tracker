/**
 * End-to-end check of the ZCZ-7 SaaS layer against a running server.
 *
 *   npm run dev                       # or: npm run build && npm start
 *   npm run verify:saas               # override with BASE_URL=http://host:port
 *
 * What it proves, in order:
 *
 *   0. 匿名可读 —— a request with no cookie reads the listing in full. This
 *      duplicates a ZCZ-6 check on purpose: the tiering change is exactly the
 *      kind of edit that regresses it.
 *   1. 匿名 / free 点导出 —— a browser gets redirected to /pricing with an
 *      explanation; a script gets 401/402 JSON. Never a bare 403.
 *   2. 升级 —— free → pro, by whichever backend is configured. With a
 *      `STRIPE_WEBHOOK_SECRET` present, the upgrade is driven through the real
 *      webhook handler with a correctly signed synthetic event, so the
 *      checkout → webhook → plan chain is exercised without a Stripe account.
 *   3. 导出解锁 —— the same URL now returns CSV containing source URLs and
 *      verbatim quotes.
 *   4. API key —— generate, call the read-only endpoint, revoke, call again
 *      and get 401.
 *
 * Like the other verify scripts it drives real HTTP rather than importing the
 * server actions, so what is tested is what a browser or a `curl` would meet.
 * Each run uses a throwaway account, so it is safe to re-run.
 */
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const RUN = Date.now();
let cookie = "";
let failures = 0;

function check(label, pass, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

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

const visibleText = (html) => html.replaceAll("<!-- -->", "");

/** `accept` defaults to a browser's, because most of these paths are pages. */
async function get(path, { accept = "text/html", headers = {}, useCookie = true } = {}) {
  const res = await fetch(BASE + path, {
    redirect: "manual",
    headers: { accept, ...(useCookie && cookie ? { cookie } : {}), ...headers },
  });
  captureCookies(res);
  return { res, body: visibleText(await res.text()) };
}

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

/** `.env.local` is not loaded into this process; read the one value we need. */
function envLocal(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith(`${name}=`));
    return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : undefined;
  } catch {
    return undefined;
  }
}

const EXPORT_PATH = "/api/export/records";
const API_PATH = "/api/v1/records";
const EMAIL = `t6-${RUN}@example.com`;
const PASSWORD = "correct-horse-8";

// ---------------------------------------------------------------------------
// 0. 匿名可读：没有 cookie 也能完整读到公开内容
// ---------------------------------------------------------------------------
console.log("-- 0. 匿名访客不需要账号就能读 --");
{
  const home = await get("/", { useCookie: false });
  check("匿名请求首页返回 200", home.res.status === 200, `status=${home.res.status}`);
  check("首页没有把内容藏到登录后面", !/请先登录|登录后可见|login-wall/.test(home.body));

  const pricing = await get("/pricing", { useCookie: false });
  check("匿名可以打开定价页", pricing.res.status === 200, `status=${pricing.res.status}`);
  check(
    "定价页如实写明浏览不需要账号",
    pricing.body.includes("浏览全部内容不需要账号"),
  );
  check("定价表里有匿名访客这一列", pricing.body.includes("匿名访客"));
}

// ---------------------------------------------------------------------------
// 1. 匿名点导出：引导注册，而不是 403 白屏
// ---------------------------------------------------------------------------
console.log("\n-- 1. 匿名 / free 点全量导出 --");
{
  const browser = await get(EXPORT_PATH, { useCookie: false });
  const location = browser.res.headers.get("location") ?? "";
  check(
    "浏览器请求被 303 引导到定价页，而不是 403",
    browser.res.status === 303 && location.includes("/pricing"),
    `status=${browser.res.status} location=${location}`,
  );
  check("引导链接带上了原因", location.includes("reason=anonymous"), location);

  // The Location is absolute and may name a different host spelling than
  // BASE (`localhost` vs `127.0.0.1`), so follow it by path, not by string
  // surgery on the origin.
  const target = location ? new URL(location) : null;
  const landing = await get(target ? target.pathname + target.search : "/pricing", {
    useCookie: false,
  });
  check(
    "落地页解释了发生了什么",
    landing.body.includes("它需要一个专业版账号"),
  );
  check(
    "落地页同时说明阅读不受影响",
    landing.body.includes("都不需要账号也能看"),
  );

  const script = await get(EXPORT_PATH, { accept: "*/*", useCookie: false });
  check("脚本请求拿到 401 而不是重定向", script.res.status === 401, `status=${script.res.status}`);
  const payload = JSON.parse(script.body);
  check("401 的 JSON 里有可读的中文说明", typeof payload.message === "string" && payload.message.length > 10);
  check("401 的 JSON 里给了升级入口", String(payload.upgradeUrl).includes("/pricing"));
}

// ---------------------------------------------------------------------------
// 2. 注册一个 free 账号
// ---------------------------------------------------------------------------
console.log("\n-- 2. 注册 free 账号 --");
{
  const { body } = await get("/register");
  await postAction("/register", {
    ...actionFieldsFor(body, 'name="email"'),
    email: EMAIL,
    password: PASSWORD,
  });
  check("注册并登录成功", cookie.startsWith("aist_session="), cookie ? "有会话 cookie" : "没有会话");

  const account = await get("/account");
  check("账户页可访问", account.res.status === 200, `status=${account.res.status}`);
  check("新账号是免费档", account.body.includes("免费"), "");
  check("账户页说明全量导出属于专业版", account.body.includes("全量导出属于专业版"));
}

// ---------------------------------------------------------------------------
// 3. free 账号点导出：清晰的升级提示
// ---------------------------------------------------------------------------
console.log("\n-- 3. free 账号点全量导出 --");
{
  const browser = await get(EXPORT_PATH);
  const location = browser.res.headers.get("location") ?? "";
  check(
    "浏览器请求被引导到定价页",
    browser.res.status === 303 && location.includes("reason=upgrade"),
    `status=${browser.res.status} location=${location}`,
  );

  const script = await get(EXPORT_PATH, { accept: "*/*" });
  check("脚本请求拿到 402（需要付费），不是 403", script.res.status === 402, `status=${script.res.status}`);
  const payload = JSON.parse(script.body);
  check("402 说明了当前是免费档", payload.message.includes("免费档"));
  check("402 没有谎称内容看不到", payload.message.includes("逐条查看"));
}

console.log("\n-- 3b. free 账号拿不到 API key --");
{
  const account = await get("/account");
  check("账户页提示 API key 属于专业版", account.body.includes("API key 属于专业版"));
  check("free 档不渲染生成表单", !account.body.includes('name="name"'), "");
}

// ---------------------------------------------------------------------------
// 4. 升级：优先走真实 webhook 链路，否则走本地模拟升级
// ---------------------------------------------------------------------------
const WEBHOOK_SECRET = envLocal("STRIPE_WEBHOOK_SECRET");

console.log(
  `\n-- 4. 升级为 pro（${WEBHOOK_SECRET ? "经 Stripe webhook 处理器，自签事件" : "本地模拟升级"}） --`,
);

let userId = "";

if (WEBHOOK_SECRET) {
  // `client_reference_id` is what Stripe round-trips for us, so the synthetic
  // event needs the account's uuid. The account page prints it.
  const account = await get("/account");
  userId = account.body.match(/data-user-id="([0-9a-f-]{36})"/)?.[1] ?? "";
  check("账户页暴露了账号 id 供 webhook 测试使用", Boolean(userId), userId || "未找到");

  if (userId) {
    const event = {
      id: `evt_test_${randomUUID()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_test_${RUN}`,
          client_reference_id: userId,
          customer: `cus_test_${RUN}`,
          subscription: `sub_test_${RUN}`,
        },
      },
    };
    const rawBody = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", WEBHOOK_SECRET)
      .update(`${t}.${rawBody}`)
      .digest("hex");

    // 4a. A tampered signature must be refused before any plan code runs.
    const bad = await fetch(`${BASE}/api/billing/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${"0".repeat(64)}` },
      body: rawBody,
    });
    check("签名错误的 webhook 被拒绝", bad.status === 400, `status=${bad.status}`);

    // 4b. The real thing.
    const ok = await fetch(`${BASE}/api/billing/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${signature}` },
      body: rawBody,
    });
    const okPayload = await ok.json();
    check("签名正确的 webhook 被接受", ok.status === 200, `status=${ok.status}`);
    check("webhook 把账号升级为 pro", okPayload.handled === true, JSON.stringify(okPayload));

    // 4c. Stripe retries; the same event must not be applied twice.
    const replay = await fetch(`${BASE}/api/billing/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${signature}` },
      body: rawBody,
    });
    const replayPayload = await replay.json();
    check(
      "重复投递的同一事件被幂等忽略",
      replay.status === 200 && replayPayload.handled === false,
      JSON.stringify(replayPayload),
    );
  }
} else {
  const pricing = await get("/pricing");
  check("定价页说明当前是模拟升级", pricing.body.includes("本地模拟升级"));
  const r = await postAction("/pricing", actionFieldsFor(pricing.body, "模拟升级为专业版"));
  check("模拟升级提交成功", r.res.status < 400, `status=${r.res.status}`);
}

{
  const account = await get("/account");
  check("账户页现在显示专业版", account.body.includes("专业版"), "");
  check(
    "账户页如实标注这不是真实付款",
    account.body.includes("没有产生任何真实费用") || account.body.includes("不是真实付款"),
  );
}

// ---------------------------------------------------------------------------
// 5. 导出随之解锁
// ---------------------------------------------------------------------------
console.log("\n-- 5. pro 账号导出完整 CSV --");
let csv = "";
{
  const res = await fetch(BASE + EXPORT_PATH, { headers: { cookie, accept: "*/*" } });
  // Bytes, not `res.text()`: the WHATWG UTF-8 decode behind `text()` strips a
  // leading BOM, so a text read cannot tell whether the BOM was ever sent —
  // and the BOM is exactly what the Excel check below is about.
  const bytes = Buffer.from(await res.arrayBuffer());
  csv = bytes.toString("utf8");
  check("导出返回 200", res.status === 200, `status=${res.status}`);
  check(
    "Content-Type 是 CSV",
    (res.headers.get("content-type") ?? "").includes("text/csv"),
    res.headers.get("content-type") ?? "",
  );
  check(
    "带 attachment 文件名",
    (res.headers.get("content-disposition") ?? "").includes(".csv"),
    res.headers.get("content-disposition") ?? "",
  );

  check(
    "文件带 UTF-8 BOM（Excel 不乱码）",
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    `前三字节 ${[...bytes.subarray(0, 3)].map((b) => b.toString(16)).join(" ")}`,
  );

  const header = csv.split("\r\n")[0].replace(/^﻿/, "");
  check("表头含 source_url", header.includes("source_url"), header.slice(0, 80) + "…");
  check("表头含 source_quote", header.includes("source_quote"));
  check("表头含 attribution_confidence", header.includes("attribution_confidence"));

  const rows = csv.trim().split("\r\n").length - 1;
  const recordCount = res.headers.get("x-record-count");
  console.log(`      导出 ${recordCount} 条记录 / ${rows} 行来源`);
  check("导出不是空的", rows > 0, `${rows} 行`);
  check("行里有真实的 http 来源链接", /,https?:\/\//.test(csv) || /"https?:\/\//.test(csv));
}

// ---------------------------------------------------------------------------
// 6. API key：生成 → 调通 → 吊销 → 失败
// ---------------------------------------------------------------------------
console.log("\n-- 6. API key 三步 --");
let token = "";
let keyId = "";
{
  const account = await get("/account");
  const r = await postAction("/account", {
    ...actionFieldsFor(account.body, 'name="name"'),
    name: `verify-${RUN}`,
  });
  token = r.body.match(/rip_test_[A-Za-z0-9_-]{20,}/)?.[0] ?? "";
  check("生成 API key 成功", Boolean(token), token ? `${token.slice(0, 16)}…` : "未拿到明文 key");

  const after = await get("/account");
  check("列表里出现这个 key", after.body.includes(`verify-${RUN}`));
  check("列表只显示前缀，不回显明文", !after.body.includes(token || "@@none@@"));
  keyId = after.body.match(/name="keyId" value="([0-9a-f-]{36})"/)?.[1] ?? "";
  check("列表提供吊销按钮", Boolean(keyId), keyId || "未找到 keyId");
}

if (token) {
  const res = await fetch(`${BASE}${API_PATH}?limit=3`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = await res.json();
  check("用 key 调只读接口返回 200", res.status === 200, `status=${res.status}`);
  check("返回了记录", Array.isArray(payload.records) && payload.records.length > 0, `total=${payload.total}`);
  check(
    "每条记录都带归因置信度",
    (payload.records ?? []).every((r) => typeof r.attributionConfidence === "string"),
  );
  check(
    "每条记录都带来源与原文引述",
    (payload.records ?? []).every((r) => r.sources?.length > 0 && r.sources.every((s) => s.url && s.quote)),
  );

  const csvByKey = await fetch(BASE + EXPORT_PATH, { headers: { "x-api-key": token } });
  check("同一个 key 也能取 CSV", csvByKey.status === 200, `status=${csvByKey.status}`);
  await csvByKey.text();

  const write = await fetch(`${BASE}${API_PATH}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  check("接口是只读的：POST 被拒", write.status === 405, `status=${write.status}`);
}

if (keyId) {
  const account = await get("/account");
  const r = await postAction("/account", {
    ...actionFieldsFor(account.body, `value="${keyId}"`),
    keyId,
  });
  check("吊销提交成功", r.res.status < 400, `status=${r.res.status}`);

  const after = await get("/account");
  check("列表标记为已吊销", after.body.includes("已吊销"));

  const res = await fetch(`${BASE}${API_PATH}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = await res.json();
  check("吊销后调用返回 401", res.status === 401, `status=${res.status}`);
  check("401 说明了是被吊销", payload.error === "revoked_key", JSON.stringify(payload));

  const csvAfter = await fetch(BASE + EXPORT_PATH, { headers: { "x-api-key": token } });
  check("吊销后也不能再导出 CSV", csvAfter.status === 401, `status=${csvAfter.status}`);
  await csvAfter.text();
}

// ---------------------------------------------------------------------------
// 7. 回归：升级之后，匿名访客读到的东西没有任何变化
// ---------------------------------------------------------------------------
console.log("\n-- 7. 分档没有把公开内容挪到账号背后 --");
{
  const saved = cookie;
  cookie = "";
  const anon = await get("/", { useCookie: false });
  check("匿名首页仍然 200", anon.res.status === 200, `status=${anon.res.status}`);
  check("匿名首页没有出现登录墙文案", !/需要登录才能查看/.test(anon.body));
  cookie = saved;
}

console.log(`\n${failures === 0 ? "all SaaS flow checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
