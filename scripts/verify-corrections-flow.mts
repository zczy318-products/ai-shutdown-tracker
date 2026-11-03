/**
 * End-to-end check of `/methodology` and `/corrections` (S2-1 / ZCZ-16).
 *
 *   npm run verify:corrections
 *
 * Same architecture as `verify-subscribe-flow.mts`, and for the same reason:
 * it copies the project into a scratch directory inside the repo, migrates a
 * throwaway PGlite database, starts its own Next dev server there and drives it
 * over HTTP. Nothing has to be running first and it cannot collide with a dev
 * server on :3000.
 *
 * **It never touches a hosted database.** `DATABASE_URL` is blanked in the
 * child environment (it wins over `PGLITE_DATA_DIR` in `resolveDbTarget`), the
 * scratch copy deliberately excludes `.env` / `.env.local` so dotenv has
 * nothing to re-import, and the first assertion in the run is that the target
 * really is PGlite. That is an acceptance criterion for this task, not a
 * precaution: the writes below land in `correction_request`, and a run that
 * silently pointed at production would be filing junk disputes in the live
 * queue.
 *
 * Every request is made with **no cookie, ever**. There is no operator phase
 * and no login anywhere in this script — the claim under test is that a company
 * can read the attribution standard and dispute a record about itself without an
 * account, so a session would defeat the point.
 *
 * Two phases:
 *
 *   1. HTTP, against the real pages and the real server action: copy fidelity,
 *      the anonymous submit path, the honest-reply wording, server-side
 *      validation with the browser's hints bypassed, the entry point on a
 *      company page, and the shared throttle.
 *   2. Direct, after the server exits and releases the database: assert what
 *      landed in `correction_request`, that every row is `pending`, that the
 *      optional email really is absent rather than empty, that the client
 *      address is stored as a digest, and that the CHECK constraints reject
 *      what the Zod schema rejects.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const APP_PORT = Number(process.env.VERIFY_CORRECTIONS_PORT ?? 3224);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const REPO = path.resolve(import.meta.dirname, "..");

/** Everything the dev server needs. Note the absence of `.env` / `.env.local`. */
const COPIED = [
  "src",
  "drizzle",
  // The 30-record dataset. The dispute entry point under test lives on a
  // company page, so the run needs at least one published record to click.
  "seed",
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
  "components.json",
  "next-env.d.ts",
  "drizzle.config.ts",
];

let failures = 0;
let serverLog = "";

function check(label: string, pass: boolean, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

/**
 * React splits adjacent text nodes with `<!-- -->` so it can hydrate them,
 * which chops up any rendered string that interpolates a value. Strip the
 * markers so assertions can be written as the text a human sees.
 */
function visibleText(html: string): string {
  return html.replaceAll("<!-- -->", "");
}

/** Tag-stripped page text, whitespace collapsed. What a reader actually gets. */
function plainText(html: string): string {
  return visibleText(html)
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------
// HTTP helpers. No cookie is ever stored or sent.
// ---------------------------------------------------------------------------

async function get(pathname: string, ip?: string) {
  const res = await fetch(BASE + pathname, {
    redirect: "manual",
    headers: ip ? { "x-forwarded-for": ip } : {},
  });
  return {
    res,
    body: visibleText(await res.text()),
    setCookie: res.headers.getSetCookie?.() ?? [],
  };
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Hidden server-action fields of the form containing `marker`.
 *
 * The values have to be un-escaped, not passed through: React serializes the
 * action's bound arguments into `$ACTION_n:0` as JSON, and in an attribute that
 * JSON's quotes arrive as `&quot;`. Posting them raw gets a flat
 * «Invalid Server Action request» 400 with nothing in the server log to say why.
 */
function actionFieldsFor(html: string, marker: string): Record<string, string> {
  const form = (html.match(/<form[\s\S]*?<\/form>/g) ?? []).find((f) => f.includes(marker));
  if (!form) throw new Error(`no form containing ${marker}`);
  const fields: Record<string, string> = {};
  for (const m of form.matchAll(/<input([^>]*type="hidden"[^>]*)>/g)) {
    const name = m[1].match(/name="([^"]*)"/)?.[1];
    if (name) fields[name] = unescapeHtml(m[1].match(/value="([^"]*)"/)?.[1] ?? "");
  }
  return fields;
}

let correctionFields: Record<string, string> = {};

type Submission = {
  recordRef?: string;
  kind?: string;
  body?: string;
  sourceUrl?: string;
  sourceQuote?: string;
  email?: string;
  source?: string;
};

/**
 * Submits the correction form the way a browser with JavaScript disabled would:
 * a plain multipart POST to the page URL carrying React's hidden `$ACTION_*`
 * field. Posting the action directly is also the honest way to test the server
 * validation, because it bypasses `required`, `minLength` and `type="url"`.
 *
 * Fields left out of `input` are posted as the empty string, which is exactly
 * what an untouched `<input>` sends — i.e. this is how "submitting with no
 * email" is actually tested rather than approximated.
 */
async function postCorrection(input: Submission, ip: string) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(correctionFields)) fd.append(k, v);
  fd.set("recordRef", input.recordRef ?? "");
  fd.set("kind", input.kind ?? "factual_error");
  fd.set("body", input.body ?? "");
  fd.set("sourceUrl", input.sourceUrl ?? "");
  fd.set("sourceQuote", input.sourceQuote ?? "");
  fd.set("email", input.email ?? "");
  fd.set("source", input.source ?? "/corrections");

  const res = await fetch(`${BASE}/corrections`, {
    method: "POST",
    body: fd,
    redirect: "manual",
    // Next refuses to replay a server action for a cross-origin POST, and
    // without this header it logs "Missing `origin` header" and hands back the
    // plain page instead of the re-render carrying the action's result.
    headers: { "x-forwarded-for": ip, origin: BASE },
  });
  return { res, body: visibleText(await res.text()), setCookie: res.headers.getSetCookie?.() ?? [] };
}

/** The `role="status"` block — the whole of what a submitter is told. */
function statusBlock(html: string): string {
  const m = html.match(/<div role="status"[\s\S]*?<\/div>/);
  return m ? m[0].replace(/\s+/g, " ").trim() : "";
}

function errorText(html: string): string {
  const m = html.match(/<p role="alert"[^>]*>([\s\S]*?)<\/p>/);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
}

/** `defaultValue` of a named field in the rendered form. */
function fieldValue(html: string, name: string): string {
  const m = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`));
  return unescapeHtml(m?.[0].match(/value="([^"]*)"/)?.[1] ?? "");
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, what: string) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate().catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    child.on("close", (code) => resolve({ code, output }));
  });
}

// ---------------------------------------------------------------------------
// The signed-off copy.
//
// Product PM wrote both pages and the wording is a deliverable: «措辞上任何一处
// 「加强」都会把转述归因变成平台断言». So the sentences that carry a commitment
// are asserted here verbatim, with whitespace removed so a line break or a
// `<strong>` boundary in the markup does not count as a change. If one of these
// fails, either the page was reworded (fix the page) or Product PM re-cut the
// copy (update this list in the same change, and nowhere else).
// ---------------------------------------------------------------------------

const METHODOLOGY_COPY = [
  "我们怎么判断一条记录",
  "一条记录=一家公司+一次与AI有关的影响事件+至少一条公开来源",
  "本站不以自己的名义断言某家公司因为AI而关闭或裁员",
  "我们不使用模型推断归因。没有任何一条记录的归因来自AI生成或自动打分。",
  "原文引述是逐字引用，长度在20到2000字符之间",
  "被反爬拦截的链接，必须有人工在浏览器里确认可访问过。",
  "这五条由数据库约束和发布前校验共同执行，不是编辑的自觉。",
  "置信度由人工选定，没有默认值",
  "必须至少有一条「公司一手材料」或「主流媒体原创报道」类型的来源，否则只能降为「中」",
  "置信度只会往下调，不会往上凑。",
  "影响类型固定四类：被AI产品替代/AI降本裁员/主动转型/报道提及",
  "结果固定七类：停止运营、破产、大幅裁员、宣布缩编计划、转型、被收购、已撤回",
  "会系统性地偏向「AI确实造成了后果」",
  "置信度用的是一条无彩的明度阶梯，深浅表示高低；结果完全不配色",
  "颜色不能独自承载含义",
  "匿名访客全部可见，没有试读截断",
  "注册不解锁任何阅读权限。",
];

const CORRECTIONS_COPY = [
  "提出异议或更正",
  "这份名单上的每一家都是真实公司。所以这一页必须存在。",
  "任何人。被收录的公司及其员工、记者、研究者、或者只是发现了一处错误的读者。不需要注册账号。",
  "归因异议——你认为这件事与AI无关，或原因另有其他",
  "我们不会仅因为被收录方不满意就撤下一条有据可查的记录；也不会因为我们已经发布过就拒绝修改。判据是证据，不是立场。",
  "哪条记录、你认为哪里不对、以及能支持你说法的公开来源",
  "这和我们收录一条记录的要求是同一个。",
  "我们现在还没有接通邮件发送，所以你不会收到任何自动回执，也不用在收件箱里等。",
  "处理结果会直接体现在对应的记录页上——那才是真正的回复。",
  "留邮箱是可选的。接通邮件之后，我们会用它回复这一条异议；在那之前它只是躺在库里。",
];

/**
 * Things neither page, and no response to a submission, may say.
 *
 * The first group is the promise we cannot keep: mail is not wired up (user
 * decision, 2026-11-03 — collect only, never send), so any of these would send
 * somebody to watch an inbox forever. The second is the wall the product口径
 * forbids on these two pages specifically.
 */
const FORBIDDEN_PROMISES = ["已发送", "已发出", "确认邮件", "请查收", "尽快回复", "天内回复", "我们会回复你"];
const FORBIDDEN_WALLS = ["注册后可见", "登录后可见", "订阅后可见", "免费试读", "继续阅读请", "升级后可见"];

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const scratch = path.join(REPO, ".verify-corrections");
const app = path.join(scratch, "app");
const dataDir = path.join(scratch, "pglite");
let server: ChildProcess | undefined;

try {
  await rm(scratch, { recursive: true, force: true });
  await mkdir(app, { recursive: true });
  for (const entry of COPIED) {
    await cp(path.join(REPO, entry), path.join(app, entry), { recursive: true });
  }
  console.log(`isolated copy: ${path.relative(REPO, app)}\n`);

  const env: NodeJS.ProcessEnv = {
    PGLITE_DATA_DIR: dataDir,
    // Blanked, not merely unset: `resolveDbTarget` prefers DATABASE_URL over
    // PGLITE_DATA_DIR, so an inherited one would send every write below to a
    // hosted database. This is the acceptance criterion «verify:* 不指向线上库»
    // and it is asserted, not assumed — see the first check in phase 1.
    DATABASE_URL: "",
    NEXT_PUBLIC_APP_URL: "",
    VERCEL_URL: "",
    NODE_ENV: "development",
  };

  const migrated = await run("npx", ["tsx", "src/db/migrate.ts"], app, env);
  check(
    "migrations apply to a fresh database",
    migrated.code === 0,
    migrated.output.trim().split("\n").at(-1),
  );
  check(
    "the migration ran against local PGlite, not a hosted database",
    migrated.output.includes("[migrate] target: PGlite") &&
      !migrated.output.includes("node-postgres"),
    migrated.output.split("\n").find((line) => line.includes("[migrate] target")) ?? "no target line",
  );
  if (migrated.code !== 0) throw new Error(migrated.output);

  const seeded = await run("npx", ["tsx", "src/db/seed.ts"], app, env);
  check(
    "the 30-record seed dataset loads",
    seeded.code === 0,
    seeded.output.trim().split("\n").at(-1),
  );
  if (seeded.code !== 0) throw new Error(seeded.output);

  server = spawn("npx", ["next", "dev", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
    cwd: app,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (c) => (serverLog += c));
  server.stderr?.on("data", (c) => (serverLog += c));
  server.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`[server] exited with ${code}`);
  });

  try {
    await waitFor(
      async () => (await fetch(`${BASE}/corrections`, { redirect: "manual" })).status === 200,
      180_000,
      "the dev server to answer on /corrections",
    );
  } catch (error) {
    console.error("\n--- server output ---\n" + serverLog.slice(-4000));
    throw error;
  }

  // -------------------------------------------------------------------------
  // Phase 1 — the anonymous HTTP path
  // -------------------------------------------------------------------------
  console.log("\n--- phase 1: the two pages, anonymously ---");

  for (const [route, expected] of [
    ["/methodology", METHODOLOGY_COPY],
    ["/corrections", CORRECTIONS_COPY],
  ] as const) {
    const page = await get(route);
    check(
      `${route} answers 200 to a request with no cookie`,
      page.res.status === 200,
      `HTTP ${page.res.status}`,
    );
    check(
      `${route} sets no cookie and issues no redirect to /login`,
      page.setCookie.length === 0 && !(page.res.headers.get("location") ?? "").includes("/login"),
      page.setCookie.join(" ") || "no Set-Cookie",
    );

    const text = plainText(page.body);
    const missing = expected.filter((sentence) => !text.includes(sentence.replace(/\s+/g, "")));
    check(
      `${route} reproduces the signed-off copy verbatim (${expected.length} passages)`,
      missing.length === 0,
      missing.length ? `missing: ${missing.slice(0, 2).join(" // ")}` : "all present",
    );

    const promised = FORBIDDEN_PROMISES.filter((phrase) => text.includes(phrase));
    check(
      `${route} promises nothing we cannot do (no mail, no reply-by date)`,
      promised.length === 0,
      promised.length ? `found ${promised.join(" / ")}` : "none of " + FORBIDDEN_PROMISES.join(" / "),
    );

    const walled = FORBIDDEN_WALLS.filter((phrase) => text.includes(phrase));
    check(
      `${route} has no login wall and no preview truncation`,
      walled.length === 0 && !/\bblur-(?:xs|sm|md|lg|xl)\b|\bline-clamp-\d/.test(page.body),
      walled.length ? `found ${walled.join(" / ")}` : "no wall copy, no blur/clamp class",
    );

    check(
      `${route} carries the footer link to the other policy page`,
      page.body.includes('href="/methodology"') && page.body.includes('href="/corrections"'),
    );
  }

  // --- the footer nav is on every public page -------------------------------
  const listing = await get("/");
  check(
    "the public listing's footer links to both policy pages",
    listing.body.includes('href="/methodology"') && listing.body.includes('href="/corrections"'),
  );
  const stats = await get("/stats");
  check(
    "the dashboard's footer links to both policy pages",
    stats.body.includes('href="/methodology"') && stats.body.includes('href="/corrections"'),
  );

  // --- the entry point on a company page ------------------------------------
  console.log("\n--- phase 1b: the entry point from a record ---");

  const slugMatch = listing.body.match(/href="\/company\/([a-z0-9][a-z0-9-]*)"/);
  check("the listing links to at least one company page", Boolean(slugMatch), slugMatch?.[1] ?? "none");
  const slug = slugMatch?.[1];

  let recordHref = "";
  if (slug) {
    const detail = await get(`/company/${slug}`);
    check(
      `/company/${slug} renders anonymously`,
      detail.res.status === 200 && detail.setCookie.length === 0,
      `HTTP ${detail.res.status}`,
    );
    const hrefMatch = detail.body.match(/href="\/corrections\?record=([^"]+)"/);
    recordHref = hrefMatch ? `/corrections?record=${hrefMatch[1]}` : "";
    check(
      "the company detail page carries a clickable dispute link",
      Boolean(hrefMatch),
      hrefMatch ? decodeURIComponent(hrefMatch[1]) : "no /corrections link on the record page",
    );
    check(
      "the dispute link's label says no account is needed",
      plainText(detail.body).includes("提出异议或更正") &&
        plainText(detail.body).includes("不需要账号"),
    );
    check(
      "the dispute link carries this record's identifier, not just the page",
      decodeURIComponent(hrefMatch?.[1] ?? "").startsWith(`${slug}:`),
      decodeURIComponent(hrefMatch?.[1] ?? ""),
    );
  }

  if (recordHref) {
    const prefilled = await get(recordHref);
    const carried = decodeURIComponent(recordHref.split("record=")[1]!);
    check(
      "following that link pre-fills 「哪条记录」 with the record identifier",
      fieldValue(prefilled.body, "recordRef") === carried,
      `field=${fieldValue(prefilled.body, "recordRef") || "(empty)"} expected=${carried}`,
    );
  }

  // --- submitting, anonymously and with no email ----------------------------
  console.log("\n--- phase 1c: the anonymous submission ---");

  const corrections = await get("/corrections");
  // `name="recordRef"` rather than `name="source"`: the subscribe form in the
  // public layout also posts a hidden `source`, and this has to find the
  // correction form's action, not that one's.
  correctionFields = actionFieldsFor(corrections.body, 'name="recordRef"');
  check(
    "the form posts a server action without JavaScript",
    Object.keys(correctionFields).some((k) => k.startsWith("$ACTION")),
    Object.keys(correctionFields).join(","),
  );
  check(
    "the email field is marked optional and is not `required`",
    /<input[^>]*name="email"[^>]*>/.test(corrections.body) &&
      !/<input[^>]*name="email"[^>]*\brequired\b/.test(corrections.body) &&
      plainText(corrections.body).includes("（可选）"),
  );

  const NO_EMAIL_BODY = "这条记录把我们公司的裁员时间写成了三月，实际公告是五月十八日，人数也不是四十人。";
  const noEmail = await postCorrection({ body: NO_EMAIL_BODY, recordRef: "verify-no-email" }, "198.51.100.1");
  const noEmailStatus = statusBlock(noEmail.body);
  check(
    "an anonymous visitor can submit with NO email at all",
    noEmail.res.status === 200 && noEmailStatus !== "" && errorText(noEmail.body) === "",
    errorText(noEmail.body) || `HTTP ${noEmail.res.status}`,
  );
  check(
    "submitting creates no session (it is not a login)",
    noEmail.setCookie.length === 0,
    noEmail.setCookie.join(" ") || "no Set-Cookie",
  );

  const statusText = plainText(noEmailStatus);
  const lied = FORBIDDEN_PROMISES.filter((phrase) => statusText.includes(phrase));
  check(
    "the post-submit copy promises no receipt and no reply-by date",
    lied.length === 0,
    lied.length ? `found ${lied.join(" / ")}` : "none of " + FORBIDDEN_PROMISES.join(" / "),
  );
  check(
    "the post-submit copy says what actually happens instead",
    statusText.includes("待处理队列") &&
      statusText.includes("还没有接通邮件发送") &&
      statusText.includes("处理结果会直接体现在对应的记录页上"),
    statusText.slice(0, 160),
  );
  // Printed raw: "attach the rendered fragment" is the only form of this claim
  // nobody has to take on trust.
  console.log(`      rendered HTML: ${noEmailStatus}`);

  const WITH_SOURCE_BODY = "归因有问题：公告里说的是业务线重组，没有提到 AI，请补入这条反方证据。";
  const withEverything = await postCorrection(
    {
      body: WITH_SOURCE_BODY,
      recordRef: "verify-full",
      kind: "attribution_dispute",
      sourceUrl: "https://example.com/statement",
      sourceQuote: "The restructuring was unrelated to artificial intelligence, the company said.",
      email: "Legal@Example.COM",
    },
    "198.51.100.2",
  );
  check(
    "a submission with a source and an email is accepted too",
    withEverything.res.status === 200 && errorText(withEverything.body) === "",
    errorText(withEverything.body) || `HTTP ${withEverything.res.status}`,
  );
  check(
    "both submissions get exactly the same response",
    statusBlock(withEverything.body) === noEmailStatus,
    statusBlock(withEverything.body).replace(/<[^>]+>/g, ""),
  );

  // --- server-side validation, with the browser's hints bypassed ------------
  const tooShort = await postCorrection({ body: "写错了" }, "198.51.100.3");
  check(
    "a body too short to act on is refused even though the POST skipped the form",
    errorText(tooShort.body).includes("至少 20 字"),
    errorText(tooShort.body) || statusBlock(tooShort.body),
  );
  check(
    "a refusal hands back what was typed instead of clearing the form",
    tooShort.body.includes("写错了"),
    "the body text survives the failed attempt",
  );

  const quoteNoUrl = await postCorrection(
    { body: NO_EMAIL_BODY + "（二）", sourceQuote: "A quote long enough to pass the length check." },
    "198.51.100.4",
  );
  check(
    "a quote with no link is refused — the same rule a published source has",
    errorText(quoteNoUrl.body).includes("来源链接"),
    errorText(quoteNoUrl.body),
  );

  const badUrl = await postCorrection(
    { body: NO_EMAIL_BODY + "（三）", sourceUrl: "javascript:alert(1)" },
    "198.51.100.5",
  );
  check(
    "a non-http(s) source link is refused",
    errorText(badUrl.body).includes("http"),
    errorText(badUrl.body),
  );

  const badEmail = await postCorrection(
    { body: NO_EMAIL_BODY + "（四）", email: "not-an-email" },
    "198.51.100.6",
  );
  check(
    "an email, if given at all, is validated",
    errorText(badEmail.body).includes("邮箱格式"),
    errorText(badEmail.body),
  );

  const badKind = await postCorrection(
    { body: NO_EMAIL_BODY + "（五）", kind: "whatever_i_want" },
    "198.51.100.7",
  );
  check(
    "an unknown 异议类型 is refused rather than stored",
    errorText(badKind.body) !== "",
    errorText(badKind.body),
  );

  // --- de-duplication -------------------------------------------------------
  const DUP_BODY = "同一条异议提交了两次，队列里应该只留一条，不要让值班的人读两遍一样的东西。";
  const dup1 = await postCorrection({ body: DUP_BODY, recordRef: "verify-dup" }, "198.51.100.8");
  const dup2 = await postCorrection({ body: DUP_BODY, recordRef: "verify-dup" }, "198.51.100.8");
  check(
    "a repeated identical submission is accepted with the same response",
    errorText(dup1.body) === "" &&
      errorText(dup2.body) === "" &&
      statusBlock(dup2.body) === statusBlock(dup1.body),
    "no «你已经提交过» leak",
  );
  // The same text again, this time carrying the link it was missing.
  await postCorrection(
    {
      body: DUP_BODY,
      recordRef: "verify-dup",
      sourceUrl: "https://example.com/added-later",
    },
    "198.51.100.8",
  );

  // --- the shared throttle --------------------------------------------------
  // Ten per hour per client address, and it is the *same* bucket /subscribe
  // uses — see the note in the action. Each submission has a distinct body so
  // de-duplication cannot be what answers.
  const perIp: string[] = [];
  for (let i = 0; i < 11; i++) {
    const r = await postCorrection(
      { body: `${NO_EMAIL_BODY} 第 ${i} 次不同的异议正文，用来确认速率限制生效。`, recordRef: `flood-${i}` },
      "203.0.113.77",
    );
    perIp.push(errorText(r.body) || "accepted");
  }
  check(
    "an 11th submission from the same client within the hour is throttled",
    perIp.slice(0, 10).every((m) => m === "accepted") && perIp[10].includes("提交过于频繁"),
    `first 10: ${new Set(perIp.slice(0, 10)).size === 1 ? perIp[0] : perIp.slice(0, 10).join(",")} | 11th: ${perIp[10]}`,
  );

  // -------------------------------------------------------------------------
  // Phase 2 — direct, after the server releases the database
  // -------------------------------------------------------------------------
  console.log("\n--- phase 2: database, server stopped ---");

  server.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    server!.once("exit", () => resolve());
    setTimeout(() => {
      server!.kill("SIGKILL");
      resolve();
    }, 15_000);
  });
  // PGlite holds a lock file until the process is gone.
  await new Promise((r) => setTimeout(r, 1500));

  process.env.PGLITE_DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;
  const { getDb } = await import("../src/db/index.ts");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();

  const rowsOf = async (ref: string) => {
    const result = await db.execute<{
      record_ref: string | null;
      kind: string;
      body: string;
      source_url: string | null;
      source_quote: string | null;
      email: string | null;
      status: string;
      source: string;
      ip_hash: string | null;
      resolved_at: Date | null;
    }>(sql`select record_ref, kind, body, source_url, source_quote, email, status, source,
                  ip_hash, resolved_at
           from correction_request where record_ref = ${ref} order by created_at`);
    return result.rows;
  };

  const noEmailRows = await rowsOf("verify-no-email");
  check(
    "the submission with no email landed as one row",
    noEmailRows.length === 1,
    `${noEmailRows.length} row(s)`,
  );
  check(
    "it is stored as `pending`, with the body and the source page, and no resolution",
    noEmailRows[0]?.status === "pending" &&
      noEmailRows[0].body === NO_EMAIL_BODY &&
      noEmailRows[0].source === "/corrections" &&
      noEmailRows[0].resolved_at === null,
    `status=${noEmailRows[0]?.status} source=${noEmailRows[0]?.source}`,
  );
  check(
    "its email column is NULL — absent, not an empty string",
    noEmailRows[0]?.email === null,
    `email=${JSON.stringify(noEmailRows[0]?.email)}`,
  );
  check(
    "and so are the two optional source columns",
    noEmailRows[0]?.source_url === null && noEmailRows[0]?.source_quote === null,
  );

  const fullRows = await rowsOf("verify-full");
  check(
    "the submission with a source kept the URL and the verbatim quote",
    fullRows[0]?.source_url === "https://example.com/statement" &&
      (fullRows[0]?.source_quote ?? "").startsWith("The restructuring was unrelated"),
    `url=${fullRows[0]?.source_url}`,
  );
  check(
    "a supplied email is stored normalized, the same as everywhere else",
    fullRows[0]?.email === "legal@example.com",
    `email=${fullRows[0]?.email}`,
  );
  check(
    "the chosen 异议类型 is stored as the semantic value",
    fullRows[0]?.kind === "attribution_dispute",
    `kind=${fullRows[0]?.kind}`,
  );

  const dupRows = await rowsOf("verify-dup");
  check(
    "three identical submissions produced exactly one queue row",
    dupRows.length === 1,
    `${dupRows.length} row(s)`,
  );
  check(
    "and the link that arrived with the third one was written onto it",
    dupRows[0]?.source_url === "https://example.com/added-later",
    `url=${dupRows[0]?.source_url}`,
  );

  // --- nothing is ever anything but pending --------------------------------
  const statuses = await db.execute<{ status: string; n: number }>(
    sql`select status, count(*)::int as n from correction_request group by status`,
  );
  check(
    "every row in the table is `pending` — nothing auto-advances",
    statuses.rows.length === 1 && statuses.rows[0]?.status === "pending",
    statuses.rows.map((r) => `${r.status}=${r.n}`).join(" ") || "table empty",
  );

  // Structural, not behavioural: the guarantee is that no code path *can* move
  // a row off `pending`, and the only module that writes this table is the
  // store. One `status:` assignment, hardcoded. A future "mark as handled"
  // helper fails this check and has to be justified on its own merits.
  const storeSource = await readFile(path.join(REPO, "src/lib/corrections/store.ts"), "utf8");
  const statusWrites = storeSource.match(/status:\s*"[a-z_]+"/g) ?? [];
  check(
    "the store writes `status` exactly once, as a hardcoded `pending`",
    statusWrites.length === 1 && statusWrites[0] === 'status: "pending"',
    statusWrites.join(" / ") || "no status write found",
  );
  check(
    "and exposes no function that resolves or closes a submission",
    !/export\s+(async\s+)?function\s+\w*(resolve|close|handle|mark|approve|reject)/i.test(
      storeSource,
    ),
  );

  // --- the client address is a digest, not an address ------------------------
  const ipHashes = await db.execute<{ ip_hash: string | null }>(
    sql`select distinct ip_hash from correction_request where ip_hash is not null`,
  );
  check(
    "the client address is stored as a SHA-256 digest, never in plaintext",
    ipHashes.rows.length > 0 &&
      ipHashes.rows.every((r) => /^[0-9a-f]{64}$/.test(r.ip_hash ?? "")) &&
      !ipHashes.rows.some((r) => (r.ip_hash ?? "").includes("198.51.100")),
    `${ipHashes.rows.length} distinct digest(s)`,
  );

  // --- the constraints, not just the Zod schema -----------------------------
  const rejects = async (label: string, statement: ReturnType<typeof sql>) => {
    let message = "";
    try {
      await db.execute(statement);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    check(`the database itself rejects ${label}`, message !== "", message.slice(0, 120) || "it was ACCEPTED");
  };

  await rejects(
    "a body too short to act on",
    sql`insert into correction_request (kind, body, dedupe_hash)
        values ('other', '太短', 'check-short')`,
  );
  await rejects(
    "a quote with no source link",
    sql`insert into correction_request (kind, body, source_quote, dedupe_hash)
        values ('other', '正文足够长，用来单独验证引述必须配一条可打开的来源链接这条约束。',
                'A quote that is long enough to clear the length bound.', 'check-quote')`,
  );
  await rejects(
    "a non-http(s) source link",
    sql`insert into correction_request (kind, body, source_url, dedupe_hash)
        values ('other', '正文足够长，用来单独验证来源链接必须是 http 或 https 这条约束。',
                'javascript:alert(1)', 'check-url')`,
  );
  await rejects(
    "an email that was not normalized before insert",
    sql`insert into correction_request (kind, body, email, dedupe_hash)
        values ('other', '正文足够长，用来单独验证邮箱必须在入库前就被规范化这条约束。',
                'Mixed@Case.COM', 'check-email')`,
  );
  await rejects(
    "a resolved status with no resolution timestamp",
    sql`insert into correction_request (kind, body, status, dedupe_hash)
        values ('other', '正文足够长，用来单独验证已处理状态必须带处理时间这条约束。',
                'corrected', 'check-status')`,
  );
  await rejects(
    "a pending row that claims a resolution timestamp",
    sql`insert into correction_request (kind, body, resolved_at, dedupe_hash)
        values ('other', '正文足够长，用来单独验证待处理状态不得带处理时间这条约束。',
                now(), 'check-pending')`,
  );

  // --- and the table is not an account table --------------------------------
  const columns = await db.execute<{ column_name: string }>(
    sql`select column_name from information_schema.columns
        where table_name = 'correction_request'`,
  );
  const names = columns.rows.map((r) => r.column_name);
  check(
    "the table has no user_id and no foreign key to users — disputing needs no account",
    !names.some((n) => /user_id|account_id|submitted_by/.test(n)),
    names.join(","),
  );
  const fks = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from information_schema.table_constraints
        where table_name = 'correction_request' and constraint_type = 'FOREIGN KEY'`,
  );
  check(
    "and no foreign key at all, so a guessed record id cannot be an existence oracle",
    fks.rows[0]?.n === 0,
    `${fks.rows[0]?.n} foreign key(s)`,
  );
} finally {
  if (server && server.exitCode === null) server.kill("SIGKILL");
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
