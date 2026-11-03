/**
 * End-to-end check of the SaaS layer (ZCZ-7) and the annual billing interval
 * (ZCZ-14), against a running server.
 *
 *   npm run dev                       # or: npm run build && npm start
 *   npm run verify:saas               # override with BASE_URL=http://host:port
 *
 * What it proves, in order:
 *
 *   0. 匿名可读 —— a request with no cookie reads the listing in full. This
 *      duplicates a ZCZ-6 check on purpose: the tiering change is exactly the
 *      kind of edit that regresses it.
 *   0b. 定价 —— the four USD figures (月付、年付总价、折合月价、省多少) are all
 *      in the anonymous HTML, there is no `￥` anywhere, and nothing else that
 *      looks like a price has crept in. `?interval=annual` renders on the
 *      server and keeps the other query parameters.
 *   1. 匿名 / free 点导出 —— a browser gets redirected to /pricing with an
 *      explanation; a script gets 401/402 JSON. Never a bare 403.
 *   2–7. 两条完整链路 —— free → pro(按月) and free → pro(按年), each: export
 *      unlocked, API key issued → used → revoked, then downgraded back to free
 *      and both capabilities gone. `plan_interval` is read back off the account
 *      page at each step, so what is asserted is the database column and not
 *      the page's prose.
 *   8. 逐项相同 —— the two chains' capability fingerprints are compared field by
 *      field. Paying for a year buys the same thing as paying for a month: the
 *      same CSV header, the same row count, the same API behaviour. This is the
 *      assertion that makes ZCZ-14 §2 ("权限表与计费周期解耦") a fact rather
 *      than a promise in a comment.
 *   9. webhook —— with a local `whsec_…`, a correctly signed synthetic event
 *      drives the real handler: a tampered signature is refused, an event
 *      *without* `metadata.billing_interval` is refused with a readable reason
 *      and leaves the plan alone, the same event *with* it upgrades the
 *      account, and a replay is idempotent.
 *
 * Like the other verify scripts it drives real HTTP rather than importing the
 * server actions, so what is tested is what a browser or a `curl` would meet.
 * Each run uses throwaway accounts, so it is safe to re-run.
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

/** The `<a>` whose href carries `needle`, so an attribute on it can be read. */
function anchorWithHref(html, needle) {
  return (html.match(/<a\b[^>]*>/g) ?? []).find((tag) => tag.includes(needle)) ?? "";
}

const EXPORT_PATH = "/api/export/records";
const API_PATH = "/api/v1/records";
const PASSWORD = "correct-horse-8";

/*
 * The expected prices, written out by hand on purpose.
 *
 * The script must not import `src/lib/pricing.ts`: a derivation checked against
 * itself proves nothing. These are the four numbers the user signed off on
 * (2026-11-03: 9.9 美金包月，包年 8 折), arrived at independently —
 * 9.90 × 12 = 118.80, × 0.8 = 95.04, ÷ 12 = 7.92, 118.80 − 95.04 = 23.76.
 */
const PRICE = {
  monthly: "US$9.90 / 月",
  annual: "US$95.04 / 年",
  effectiveMonthly: "US$7.92 / 月",
  saving: "US$23.76",
  free: "US$0",
};
/** Every USD amount allowed to appear on /pricing. Anything else is a bug. */
const ALLOWED_USD = new Set(["US$0", "US$9.90", "US$95.04", "US$7.92", "US$23.76"]);

const INTERVALS = [
  { key: "monthly", zh: "按月", price: PRICE.monthly },
  { key: "annual", zh: "按年", price: PRICE.annual },
];

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
  check(
    "注册不解锁阅读这句口径没丢",
    pricing.body.includes("注册只是为了成为付费主体，它不解锁任何阅读权限"),
  );
  check(
    "对照表仍然是四列身份，没有因为年付变成五列",
    ["匿名访客", "邮件订阅者", "账号 · 免费", "账号 · 专业版"].every((c) =>
      pricing.body.includes(c),
    ) && !/第五列|账号 · 专业版（年）/.test(pricing.body),
  );
}

// ---------------------------------------------------------------------------
// 0b. 定价：四个数都在，币种只有 USD，没有兑现不了的承诺
// ---------------------------------------------------------------------------
console.log("\n-- 0b. 月付与年付的四个数（匿名、无需交互） --");
{
  const pricing = await get("/pricing", { useCookie: false });

  // 月付已上线，年付是 ZCZ-14 新增。四个数必须在同一次匿名 GET 的 HTML 里，
  // 不许"点一下才显示"——访客不该为了知道另一种周期多少钱而先点一次。
  check(`渲染出月付 ${PRICE.monthly}`, pricing.body.includes(PRICE.monthly));
  check(`渲染出年付总价 ${PRICE.annual}`, pricing.body.includes(PRICE.annual));
  check(`渲染出折合月价 ${PRICE.effectiveMonthly}`, pricing.body.includes(PRICE.effectiveMonthly));
  check(`渲染出省下的金额 ${PRICE.saving}`, pricing.body.includes(PRICE.saving));
  check("写明了折扣幅度（8 折）", pricing.body.includes("8 折"));

  // 改价最常见的失败不是忘了改，而是改了一处、另一处还留着旧币种，
  // 于是同一页同时写着两个货币，谁也不知道到底收多少。
  //
  // 下面两行是本仓库里仅剩的人民币符号，它们在**否定**断言里：这是查它的探针，
  // 不是在替旧定价站台。把字符从这里删掉等于把这道闸删掉。
  check(
    "全页没有人民币符号，也没有旧价格",
    !/[￥¥]/.test(pricing.body) && !/49\s*\/\s*月/.test(pricing.body),
    (pricing.body.match(/.{0,12}[￥¥].{0,12}/) ?? ["无"])[0],
  );

  // 页面上写着 8 折，收的钱就不能多于 8 折。向上取整到 $95.99 / $96 会让那句话
  // 变成假话，所以这里把允许出现的金额逐个列死：多一个数就是多了一个说法。
  const amounts = new Set([...pricing.body.matchAll(/US\$\d[\d,]*(?:\.\d{2})?/g)].map((m) => m[0]));
  check(
    "页面上的 USD 金额只有这五个，没有第二套价格",
    [...amounts].every((a) => ALLOWED_USD.has(a)) && amounts.size === ALLOWED_USD.size,
    [...amounts].sort().join(" | "),
  );

  // 退款 / proration / 转周期都没有实现，页面就不许暗示它们存在。
  check(
    "没有退款、按比例补差价或中途转周期的承诺",
    !/退款|退费|退差|按比例|proration|转为按月|转成按月|换成按月|随时取消/.test(pricing.body),
    (pricing.body.match(/.{0,16}(退款|退费|退差|按比例|proration|随时取消).{0,16}/) ?? ["无"])[0],
  );
}

console.log("\n-- 0c. ?interval= 走 URL，服务端直出，其他 query 不丢 --");
{
  const annual = await get("/pricing?interval=annual", { useCookie: false });
  check("匿名直接访问 ?interval=annual 返回 200", annual.res.status === 200, `status=${annual.res.status}`);
  check(
    "年付这一项被标记为当前选择（aria-current）",
    anchorWithHref(annual.body, "interval=annual").includes('aria-current="true"'),
    anchorWithHref(annual.body, "interval=annual").slice(0, 120),
  );
  check(
    "结账按钮买的是按年",
    /按年/.test(annual.body) && annual.body.includes('name="interval" value="annual"'),
  );

  const monthly = await get("/pricing?interval=monthly", { useCookie: false });
  check(
    "?interval=monthly 时当前选择是按月",
    anchorWithHref(monthly.body, "interval=monthly").includes('aria-current="true"') &&
      monthly.body.includes('name="interval" value="monthly"'),
  );

  const bogus = await get("/pricing?interval=weekly", { useCookie: false });
  check(
    "无法识别的 interval 不报错，退回按月展示",
    bogus.res.status === 200 && bogus.body.includes('name="interval" value="monthly"'),
    `status=${bogus.res.status}`,
  );

  // 切周期不许把访客为什么来到这一页的上下文丢掉。
  const withQuery = await get("/pricing?reason=upgrade&from=account&interval=monthly", {
    useCookie: false,
  });
  const annualHref = (anchorWithHref(withQuery.body, "interval=annual").match(/href="([^"]*)"/) ??
    [])[1];
  check(
    "切到年付的链接保留了其他 query",
    Boolean(annualHref) &&
      annualHref.includes("reason=upgrade") &&
      annualHref.includes("from=account") &&
      annualHref.includes("interval=annual"),
    annualHref ?? "未找到年付链接",
  );
  check("带 query 时落地提示仍然显示", withQuery.body.includes("全量 CSV 导出属于专业版"));
}

// ---------------------------------------------------------------------------
// 1. 匿名点导出：引导注册，而不是 403 白屏
// ---------------------------------------------------------------------------
console.log("\n-- 1. 匿名点全量导出 --");
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
  check("落地页解释了发生了什么", landing.body.includes("它需要一个专业版账号"));
  check("落地页同时说明阅读不受影响", landing.body.includes("都不需要账号也能看"));

  const script = await get(EXPORT_PATH, { accept: "*/*", useCookie: false });
  check("脚本请求拿到 401 而不是重定向", script.res.status === 401, `status=${script.res.status}`);
  const payload = JSON.parse(script.body);
  check(
    "401 的 JSON 里有可读的中文说明",
    typeof payload.message === "string" && payload.message.length > 10,
  );
  check("401 的 JSON 里给了升级入口", String(payload.upgradeUrl).includes("/pricing"));
}

// ---------------------------------------------------------------------------
// 2–7. 两条完整链路：free → pro(按月/按年) → 导出 + key → 降级 → 两者失效
// ---------------------------------------------------------------------------
const WEBHOOK_SECRET = envLocal("STRIPE_WEBHOOK_SECRET");

/** Registers a throwaway account and returns its id. Resets the cookie jar. */
async function registerFreshAccount(tag) {
  cookie = "";
  const email = `t6-${RUN}-${tag}@example.com`;
  const { body } = await get("/register");
  await postAction("/register", {
    ...actionFieldsFor(body, 'name="email"'),
    email,
    password: PASSWORD,
  });
  check(
    `[${tag}] 注册并登录成功`,
    cookie.startsWith("aist_session="),
    cookie ? email : "没有会话 cookie",
  );
  const account = await get("/account");
  return account.body.match(/data-user-id="([0-9a-f-]{36})"/)?.[1] ?? "";
}

/** Reads `users.plan` / `users.plan_interval` back off the account page. */
async function readPlanFromAccount() {
  const { body } = await get("/account");
  return {
    plan: body.match(/data-plan="([a-z]*)"/)?.[1] ?? "",
    interval: body.match(/data-plan-interval="([a-z]*)"/)?.[1] ?? "",
    body,
  };
}

/**
 * Upgrades the signed-in account to pro on the given interval.
 *
 * Prefers the simulated switch, because that is the path `BILLING_SIMULATION`
 * exists for and the one a demo uses; falls back to driving the real webhook
 * handler with a signed synthetic event when only a `whsec_…` is configured.
 */
async function upgradeTo(interval, userId, tag) {
  const pricing = await get(`/pricing?interval=${interval}`);
  const hasSimulatedButton =
    pricing.body.includes("本地模拟升级") &&
    pricing.body.includes(`name="interval" value="${interval}"`);

  if (hasSimulatedButton) {
    const r = await postAction(
      `/pricing?interval=${interval}`,
      actionFieldsFor(pricing.body, `value="${interval}"`),
    );
    check(`[${tag}] 模拟升级提交成功`, r.res.status < 400, `status=${r.res.status}`);
    return;
  }

  if (WEBHOOK_SECRET && userId) {
    const ok = await postWebhook({
      userId,
      interval,
      sessionId: `cs_test_${RUN}_${tag}`,
    });
    check(`[${tag}] 经 webhook 升级成功`, ok.payload.handled === true, JSON.stringify(ok.payload));
    return;
  }

  check(
    `[${tag}] 有可用的升级路径`,
    false,
    "当前配置既没有模拟升级按钮，也没有 STRIPE_WEBHOOK_SECRET：" +
      "设 BILLING_SIMULATION=true 或配一个本地 whsec_… 再跑",
  );
}

/** Posts a correctly signed synthetic `checkout.session.completed`. */
async function postWebhook({ userId, interval, sessionId, eventId }) {
  const event = {
    id: eventId ?? `evt_test_${randomUUID()}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        client_reference_id: userId,
        customer: `cus_test_${sessionId}`,
        subscription: `sub_test_${sessionId}`,
        // `interval === undefined` is the "event arrived without a billing
        // interval" case the handler must refuse rather than guess at.
        ...(interval ? { metadata: { billing_interval: interval } } : {}),
      },
    },
  };
  const rawBody = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest("hex");
  const res = await fetch(`${BASE}/api/billing/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${signature}` },
    body: rawBody,
  });
  return { res, payload: await res.json(), rawBody, signature, t };
}

/**
 * The whole chain for one billing interval, returning a fingerprint of
 * everything the plan unlocked. Section 8 compares the two fingerprints.
 */
async function runChain({ key: interval, zh, price }) {
  const tag = interval;
  console.log(`\n== 链路 ${zh}（${price}） ==`);

  const userId = await registerFreshAccount(tag);
  check(`[${tag}] 账户页暴露了账号 id`, Boolean(userId), userId || "未找到");

  // --- free 状态 ----------------------------------------------------------
  {
    const { plan, interval: planInterval, body } = await readPlanFromAccount();
    check(`[${tag}] 新账号是免费档`, plan === "free", `data-plan=${plan}`);
    check(
      `[${tag}] 免费档的 plan_interval 是空的`,
      planInterval === "",
      `data-plan-interval=${planInterval}`,
    );
    check(`[${tag}] 账户页说明全量导出属于专业版`, body.includes("全量导出属于专业版"));
    check(`[${tag}] 账户页提示 API key 属于专业版`, body.includes("API key 属于专业版"));

    const browser = await get(EXPORT_PATH);
    check(
      `[${tag}] free 点导出被引导到定价页`,
      browser.res.status === 303 &&
        (browser.res.headers.get("location") ?? "").includes("reason=upgrade"),
      `status=${browser.res.status}`,
    );
    const script = await get(EXPORT_PATH, { accept: "*/*" });
    check(`[${tag}] free 的脚本请求是 402，不是 403`, script.res.status === 402, `status=${script.res.status}`);
    const payload = JSON.parse(script.body);
    check(`[${tag}] 402 说明了当前是免费档`, payload.message.includes("免费档"));
    check(`[${tag}] 402 没有谎称内容看不到`, payload.message.includes("逐条查看"));
  }

  // --- 升级 --------------------------------------------------------------
  await upgradeTo(interval, userId, tag);
  {
    const { plan, interval: planInterval, body } = await readPlanFromAccount();
    check(`[${tag}] 账户页显示专业版`, plan === "pro", `data-plan=${plan}`);
    check(
      `[${tag}] 库里 plan_interval = ${interval}`,
      planInterval === interval,
      `data-plan-interval=${planInterval}`,
    );
    check(`[${tag}] 账户页写出了计费周期「${zh}」`, body.includes(zh));
    check(`[${tag}] 账户页写出了该周期的价格`, body.includes(price), price);
    check(
      `[${tag}] 账户页如实标注这不是真实付款`,
      body.includes("没有产生任何真实费用") || body.includes("不是真实付款"),
    );
  }

  // --- 导出解锁 -----------------------------------------------------------
  const fingerprint = { interval };
  {
    const res = await fetch(BASE + EXPORT_PATH, { headers: { cookie, accept: "*/*" } });
    // Bytes, not `res.text()`: the WHATWG UTF-8 decode behind `text()` strips a
    // leading BOM, so a text read cannot tell whether the BOM was ever sent —
    // and the BOM is exactly what the Excel check below is about.
    const bytes = Buffer.from(await res.arrayBuffer());
    const csv = bytes.toString("utf8");
    check(`[${tag}] 导出返回 200`, res.status === 200, `status=${res.status}`);
    check(
      `[${tag}] Content-Type 是 CSV`,
      (res.headers.get("content-type") ?? "").includes("text/csv"),
      res.headers.get("content-type") ?? "",
    );
    check(
      `[${tag}] 带 attachment 文件名`,
      (res.headers.get("content-disposition") ?? "").includes(".csv"),
      res.headers.get("content-disposition") ?? "",
    );
    check(
      `[${tag}] 文件带 UTF-8 BOM（Excel 不乱码）`,
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
      `前三字节 ${[...bytes.subarray(0, 3)].map((b) => b.toString(16)).join(" ")}`,
    );

    const header = csv.split("\r\n")[0].replace(/^﻿/, "");
    check(`[${tag}] 表头含 source_url`, header.includes("source_url"), header.slice(0, 80) + "…");
    check(`[${tag}] 表头含 source_quote`, header.includes("source_quote"));
    check(`[${tag}] 表头含 attribution_confidence`, header.includes("attribution_confidence"));
    check(`[${tag}] 行里有真实的 http 来源链接`, /,https?:\/\//.test(csv) || /"https?:\/\//.test(csv));

    const rows = csv.trim().split("\r\n").length - 1;
    check(`[${tag}] 导出不是空的`, rows > 0, `${rows} 行`);
    console.log(`      导出 ${res.headers.get("x-record-count")} 条记录 / ${rows} 行来源`);

    fingerprint.csvStatus = res.status;
    fingerprint.csvHeader = header;
    fingerprint.csvRows = rows;
    fingerprint.csvRecordCount = res.headers.get("x-record-count");
  }

  // --- API key：生成 → 调通 → 吊销 → 失败 --------------------------------
  {
    const account = await get("/account");
    const issued = await postAction("/account", {
      ...actionFieldsFor(account.body, 'name="name"'),
      name: `verify-${RUN}-${tag}`,
    });
    const token = issued.body.match(/rip_test_[A-Za-z0-9_-]{20,}/)?.[0] ?? "";
    check(`[${tag}] 生成 API key 成功`, Boolean(token), token ? `${token.slice(0, 16)}…` : "未拿到明文 key");

    const after = await get("/account");
    check(`[${tag}] 列表里出现这个 key`, after.body.includes(`verify-${RUN}-${tag}`));
    check(`[${tag}] 列表只显示前缀，不回显明文`, !after.body.includes(token || "@@none@@"));
    const keyId = after.body.match(/name="keyId" value="([0-9a-f-]{36})"/)?.[1] ?? "";
    check(`[${tag}] 列表提供吊销按钮`, Boolean(keyId), keyId || "未找到 keyId");

    if (token) {
      const res = await fetch(`${BASE}${API_PATH}?limit=3`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      check(`[${tag}] 用 key 调只读接口返回 200`, res.status === 200, `status=${res.status}`);
      check(
        `[${tag}] 返回了记录`,
        Array.isArray(payload.records) && payload.records.length > 0,
        `total=${payload.total}`,
      );
      check(
        `[${tag}] 每条记录都带归因置信度`,
        (payload.records ?? []).every((r) => typeof r.attributionConfidence === "string"),
      );
      check(
        `[${tag}] 每条记录都带来源与原文引述`,
        (payload.records ?? []).every(
          (r) => r.sources?.length > 0 && r.sources.every((s) => s.url && s.quote),
        ),
      );

      const csvByKey = await fetch(BASE + EXPORT_PATH, { headers: { "x-api-key": token } });
      check(`[${tag}] 同一个 key 也能取 CSV`, csvByKey.status === 200, `status=${csvByKey.status}`);
      await csvByKey.text();

      const write = await fetch(`${BASE}${API_PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      check(`[${tag}] 接口是只读的：POST 被拒`, write.status === 405, `status=${write.status}`);

      fingerprint.apiStatus = res.status;
      fingerprint.apiTotal = payload.total;
      fingerprint.apiReturned = payload.records?.length ?? 0;
      fingerprint.apiRecordKeys = Object.keys(payload.records?.[0] ?? {}).sort().join(",");
      fingerprint.apiSourceKeys = Object.keys(payload.records?.[0]?.sources?.[0] ?? {})
        .sort()
        .join(",");
      fingerprint.csvByKeyStatus = csvByKey.status;
      fingerprint.writeStatus = write.status;
    }

    if (keyId && token) {
      const list = await get("/account");
      const revoked = await postAction("/account", {
        ...actionFieldsFor(list.body, `value="${keyId}"`),
        keyId,
      });
      check(`[${tag}] 吊销提交成功`, revoked.res.status < 400, `status=${revoked.res.status}`);
      const afterRevoke = await get("/account");
      check(`[${tag}] 列表标记为已吊销`, afterRevoke.body.includes("已吊销"));

      const res = await fetch(`${BASE}${API_PATH}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      check(`[${tag}] 吊销后调用返回 401`, res.status === 401, `status=${res.status}`);
      check(`[${tag}] 401 说明了是被吊销`, payload.error === "revoked_key", JSON.stringify(payload));
      const csvAfter = await fetch(BASE + EXPORT_PATH, { headers: { "x-api-key": token } });
      check(`[${tag}] 吊销后也不能再导出 CSV`, csvAfter.status === 401, `status=${csvAfter.status}`);
      await csvAfter.text();

      fingerprint.revokedApiStatus = res.status;
      fingerprint.revokedApiError = payload.error;
      fingerprint.revokedCsvStatus = csvAfter.status;
    }
  }

  // --- 降级：导出与 key 同时失效 ------------------------------------------
  // A second, *live* key is issued first: proving a downgrade kills a key that
  // was never revoked is the point, and the key above is already revoked.
  {
    const account = await get("/account");
    const issued = await postAction("/account", {
      ...actionFieldsFor(account.body, 'name="name"'),
      name: `verify-${RUN}-${tag}-live`,
    });
    const liveToken = issued.body.match(/rip_test_[A-Za-z0-9_-]{20,}/)?.[0] ?? "";
    check(`[${tag}] 降级前再签发一个未吊销的 key`, Boolean(liveToken));

    const page = await get("/account");
    let downgraded = false;
    try {
      const r = await postAction("/account", actionFieldsFor(page.body, "模拟降级回免费档"));
      check(`[${tag}] 模拟降级提交成功`, r.res.status < 400, `status=${r.res.status}`);
      downgraded = true;
    } catch {
      // stripe_test mode offers no local downgrade button on purpose: a
      // cancellation has to come back as a webhook event.
      check(
        `[${tag}] 能演示降级`,
        false,
        "账户页没有模拟降级按钮（当前不是 simulated 模式），这一段无法演示",
      );
    }

    if (downgraded) {
      const { plan, interval: planInterval } = await readPlanFromAccount();
      check(`[${tag}] 降级后回到免费档`, plan === "free", `data-plan=${plan}`);
      check(
        `[${tag}] 降级后 plan_interval 被清空`,
        planInterval === "",
        `data-plan-interval=${planInterval}`,
      );

      const script = await get(EXPORT_PATH, { accept: "*/*" });
      check(`[${tag}] 降级后导出失效（402）`, script.res.status === 402, `status=${script.res.status}`);

      if (liveToken) {
        const res = await fetch(`${BASE}${API_PATH}`, {
          headers: { authorization: `Bearer ${liveToken}` },
        });
        const payload = await res.json();
        check(
          `[${tag}] 降级后未吊销的 key 也失效（402 plan_required）`,
          res.status === 402 && payload.error === "plan_required",
          `status=${res.status} ${JSON.stringify(payload)}`,
        );
      }

      fingerprint.downgradedExportStatus = 402;
    }
  }

  return fingerprint;
}

const fingerprints = [];
for (const spec of INTERVALS) {
  fingerprints.push(await runChain(spec));
}

// ---------------------------------------------------------------------------
// 8. 两条链路解锁的能力逐项相同
// ---------------------------------------------------------------------------
console.log("\n-- 8. 年付与月付解锁的权限逐项相同 --");
{
  const [monthly, annual] = fingerprints;
  const keys = [...new Set([...Object.keys(monthly), ...Object.keys(annual)])]
    .filter((k) => k !== "interval")
    .sort();

  check("两条链路都跑完了，有东西可比", keys.length > 8, `${keys.length} 项`);
  for (const key of keys) {
    check(
      `按月与按年的 ${key} 相同`,
      JSON.stringify(monthly[key]) === JSON.stringify(annual[key]),
      `monthly=${JSON.stringify(monthly[key])} annual=${JSON.stringify(annual[key])}`,
    );
  }
  // The one thing that must differ, as a control: if even this matched, the
  // comparison above would be comparing a chain against itself.
  check(
    "但两条链路的计费周期确实不同（对照）",
    monthly.interval === "monthly" && annual.interval === "annual",
    `${monthly.interval} vs ${annual.interval}`,
  );
}

// ---------------------------------------------------------------------------
// 9. webhook：interval 必须由事件带来，读不到就不生效
// ---------------------------------------------------------------------------
if (!WEBHOOK_SECRET) {
  console.log(
    "\n-- 9. webhook 这一段已跳过：未配置 STRIPE_WEBHOOK_SECRET --" +
      "\n      要跑这一段：STRIPE_WEBHOOK_SECRET=whsec_local_test npm run verify:saas",
  );
} else {
  console.log("\n-- 9. webhook（本地 whsec_… + 自签事件） --");
  const userId = await registerFreshAccount("webhook");

  if (userId) {
    // 9a. A tampered signature must be refused before any plan code runs.
    const { rawBody, t } = await (async () => {
      const event = {
        id: `evt_test_${randomUUID()}`,
        type: "checkout.session.completed",
        data: { object: { id: "cs_test_bad", client_reference_id: userId } },
      };
      return { rawBody: JSON.stringify(event), t: Math.floor(Date.now() / 1000) };
    })();
    const bad = await fetch(`${BASE}/api/billing/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${t},v1=${"0".repeat(64)}`,
      },
      body: rawBody,
    });
    check("签名错误的 webhook 被拒绝", bad.status === 400, `status=${bad.status}`);
    await bad.text();

    // 9b. 不带 billing_interval 的事件：不生效，原因可读，套餐不动。
    //     这是本任务最关键的一条——猜一个月付回去，和"解析 price id"是同一个病。
    const missing = await postWebhook({ userId, sessionId: `cs_test_${RUN}_missing` });
    check("签名正确但缺 interval 的事件返回 200", missing.res.status === 200, `status=${missing.res.status}`);
    check(
      "缺 interval 的事件没有生效",
      missing.payload.handled === false,
      JSON.stringify(missing.payload),
    );
    check(
      "拒绝的原因可读，并且明说不从 price id 反推",
      String(missing.payload.detail ?? "").includes("billing_interval") &&
        String(missing.payload.detail ?? "").includes("price id"),
      String(missing.payload.detail ?? ""),
    );
    {
      const { plan, interval } = await readPlanFromAccount();
      check(
        "缺 interval 的事件没有把账号改成 pro",
        plan === "free" && interval === "",
        `data-plan=${plan} data-plan-interval=${interval}`,
      );
    }

    // 9c. 带 billing_interval 的同类事件：生效，并按事件里的周期落库。
    const good = await postWebhook({
      userId,
      interval: "annual",
      sessionId: `cs_test_${RUN}_annual`,
      eventId: `evt_test_${RUN}_annual`,
    });
    check("带 interval 的事件被接受", good.res.status === 200, `status=${good.res.status}`);
    check("带 interval 的事件生效", good.payload.handled === true, JSON.stringify(good.payload));
    {
      const { plan, interval } = await readPlanFromAccount();
      check(
        "webhook 写进库的是事件里的周期（annual）",
        plan === "pro" && interval === "annual",
        `data-plan=${plan} data-plan-interval=${interval}`,
      );
    }

    // 9d. Stripe retries; the same event must not be applied twice.
    const replay = await postWebhook({
      userId,
      interval: "annual",
      sessionId: `cs_test_${RUN}_annual`,
      eventId: `evt_test_${RUN}_annual`,
    });
    check(
      "重复投递的同一事件被幂等忽略",
      replay.res.status === 200 && replay.payload.handled === false,
      JSON.stringify(replay.payload),
    );
  }
}

// ---------------------------------------------------------------------------
// 10. 回归：升级之后，匿名访客读到的东西没有任何变化
// ---------------------------------------------------------------------------
console.log("\n-- 10. 分档没有把公开内容挪到账号背后 --");
{
  const anon = await get("/", { useCookie: false });
  check("匿名首页仍然 200", anon.res.status === 200, `status=${anon.res.status}`);
  check("匿名首页没有出现登录墙文案", !/需要登录才能查看/.test(anon.body));
}

console.log(`\n${failures === 0 ? "all SaaS flow checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
