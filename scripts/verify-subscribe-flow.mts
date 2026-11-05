/**
 * End-to-end check of the anonymous email subscription (T10 / ZCZ-11).
 *
 *   npm run verify:subscribe
 *
 * Self-contained: it copies the project into a scratch directory, applies the
 * migrations to a throwaway PGlite database, starts its own Next dev server
 * there and drives it over HTTP. Nothing has to be running first, and it cannot
 * collide with a dev server you already have on :3000 (a second `next dev` in
 * the same project would fight over `.next`).
 *
 * The scratch directory is `.verify-subscribe/` *inside* the repo rather than
 * under /tmp, and it deliberately does not get a `package-lock.json`: Turbopack
 * picks the workspace root by finding the nearest lockfile, so from there it
 * walks up and finds the repo's real `node_modules`. A copy outside the repo
 * cannot resolve `next` at all ("files outside of the workspace root are not
 * compiled"), and a symlinked `node_modules` does not fix it.
 *
 * Why its own server rather than `BASE_URL`: with no mail provider configured
 * the confirm and unsubscribe links only exist in the **server log**, so the
 * script has to own the process whose stdout it is reading. That is also the
 * point being verified — the `log` driver has to put a usable link somewhere
 * and report the mail as undelivered.
 *
 * Two phases:
 *
 *   1. HTTP, against the real pages and the real server action, with no cookie
 *      ever sent. This is the anonymous-visitor path.
 *   2. Direct, after the server has exited and released the database: assert
 *      what actually landed in `subscriber`, and exercise the store functions
 *      for the two cases HTTP cannot reach while the server holds the file lock
 *      (a token past its expiry, and the mailable-recipients query).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const APP_PORT = Number(process.env.VERIFY_SUBSCRIBE_PORT ?? 3222);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const RUN = Date.now();
const REPO = path.resolve(import.meta.dirname, "..");

/** Everything the dev server needs; `.next`, `.git` and node_modules stay behind. */
const COPIED = [
  "src",
  "drizzle",
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
  "components.json",
  "next-env.d.ts",
  "drizzle.config.ts",
  "research/2026-11-04-confirmed-shutdowns/companies.json",
];

let failures = 0;
let serverLog = "";

function check(label: string, pass: boolean, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function email(tag: string): string {
  return `t10-${tag}-${RUN}@example.com`;
}

/**
 * React splits adjacent text nodes with `<!-- -->` so it can hydrate them,
 * which chops up any rendered string that interpolates a value. Strip the
 * markers so assertions can be written as the text a human sees.
 */
function visibleText(html: string): string {
  return html.replaceAll("<!-- -->", "");
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// ---------------------------------------------------------------------------
// HTTP helpers. No cookie is ever stored or sent: the claim under test is that
// subscribing works with no account and no session.
// ---------------------------------------------------------------------------

async function get(pathname: string, ip?: string) {
  const res = await fetch(BASE + pathname, {
    redirect: "manual",
    headers: ip ? { "x-forwarded-for": ip } : {},
  });
  return { res, body: visibleText(await res.text()), setCookie: res.headers.getSetCookie?.() ?? [] };
}

/**
 * The one request in this script that carries a session, used only for the
 * `/admin` subscriber view. Everything about subscribing itself is asserted
 * without a cookie.
 */
async function getAs(pathname: string, cookie: string) {
  const res = await fetch(BASE + pathname, { redirect: "manual", headers: { cookie } });
  return { res, body: visibleText(await res.text()) };
}

/** Hidden server-action fields of the form containing `marker`. */
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

let subscribeFields: Record<string, string> = {};

/**
 * Every address this script expects to find a row for: the ones whose
 * submission came back accepted. Throttled and malformed submissions are
 * excluded, which is what makes it a usable expectation for the total the
 * `/admin` view prints.
 */
const expectedStored = new Set<string>();

/**
 * Submits the subscribe form the way a browser with JavaScript disabled would:
 * a plain multipart POST to the page URL carrying React's hidden `$ACTION_*`
 * field. Posting the action directly is also the honest way to test the server
 * validation, because it bypasses the `required` / `type="email"` attributes.
 */
async function postSubscribe(address: string, ip: string, source = "/") {
  const fd = new FormData();
  for (const [k, v] of Object.entries(subscribeFields)) fd.append(k, v);
  fd.set("email", address);
  fd.set("source", source);

  const res = await fetch(`${BASE}/`, {
    method: "POST",
    body: fd,
    redirect: "manual",
    // Next refuses to replay a server action for a cross-origin POST, and
    // without this header it logs "Missing `origin` header" and hands back the
    // plain page instead of the re-render carrying the action's result.
    headers: { "x-forwarded-for": ip, origin: BASE },
  });
  const body = visibleText(await res.text());
  // Hoisted: `errorText` is declared below.
  if (!errorText(body)) expectedStored.add(address);
  return { res, body };
}

/**
 * The `role="status"` block is the whole of what a visitor is told after a
 * submission. Comparing just this block — rather than two full HTML documents,
 * which differ in build-time noise — is what makes "the response is identical"
 * a checkable claim.
 */
function statusBlock(html: string): string {
  const m = html.match(/<div role="status"[\s\S]*?<\/div>/);
  return m ? m[0].replace(/\s+/g, " ").trim() : "";
}

function errorText(html: string): string {
  const m = html.match(/<p role="alert"[^>]*>([\s\S]*?)<\/p>/);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
}

/** The links the `log` mail driver wrote to stdout, newest last. */
function loggedLinks(kind: "confirm" | "unsubscribe", address: string): string[] {
  // Each logged message starts with the `to:` line, so scope the search to the
  // block belonging to this address.
  const blocks = serverLog.split("[mailer:log]").filter((b) => b.includes(`to:      ${address}`));
  const pattern = new RegExp(`http://[^\\s<"]*/subscribe/${kind}\\?token=[A-Za-z0-9_-]+`, "g");
  return blocks.flatMap((b) => b.match(pattern) ?? []);
}

function tokenOf(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get("token") ?? "");
}

/** An absolute logged link as a path this script can `get()`. */
function pathOf(url: string): string {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search;
}

/**
 * The three counters of the `/admin` distribution card, read back out of the
 * rendered page. Tag-stripped rather than parsed: the claim being checked is
 * what an operator sees, not the markup it arrived in.
 */
function distributionOf(html: string): Record<"pending" | "confirmed" | "unsubscribed", number> {
  const block = html.match(/订阅分布[\s\S]*?<\/dl>/)?.[0] ?? "";
  const text = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const read = (label: string) => Number(text.match(new RegExp(`${label} (\\d+)`))?.[1] ?? NaN);
  return {
    pending: read("待确认"),
    confirmed: read("已确认"),
    unsubscribed: read("已退订"),
  };
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
// Setup
// ---------------------------------------------------------------------------

const scratch = path.join(REPO, ".verify-subscribe");
const app = path.join(scratch, "app");
const dataDir = path.join(scratch, "pglite");
let server: ChildProcess | undefined;

/** Stop the owned server group, including Next's compiler workers. */
function signalServer(signal: NodeJS.Signals) {
  if (!server?.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-server.pid, signal);
    else server.kill(signal);
  } catch {
    // The owned process group may already have exited.
  }
}
const operator = email("operator");
const operatorId = randomUUID();
const operatorPassword = randomBytes(24).toString("base64url");

try {
  await rm(scratch, { recursive: true, force: true });
  await mkdir(app, { recursive: true });
  for (const entry of COPIED) {
    await mkdir(path.dirname(path.join(app, entry)), { recursive: true });
    await cp(path.join(REPO, entry), path.join(app, entry), { recursive: true });
  }
  console.log(`isolated copy: ${path.relative(REPO, app)}\n`);

  const env: NodeJS.ProcessEnv = {
    PGLITE_DATA_DIR: dataDir,
    DATABASE_URL: "",
    ADMIN_USER_IDS: operatorId,
    VERIFY_OPERATOR_EMAIL: operator,
    VERIFY_OPERATOR_ID: operatorId,
    VERIFY_OPERATOR_PASSWORD: operatorPassword,
    MAIL_LOG_CONTENT: "true",
    TRUST_PROXY: "true",
    VERCEL: "",
    // Unset so the confirm links are built from the request Host, i.e. point at
    // this script's own server rather than at a deployment.
    NEXT_PUBLIC_APP_URL: "",
    VERCEL_URL: "",
    // Raw mail content is explicitly enabled only in this isolated local fixture.
    NODE_ENV: "development",
  };

  const migrated = await run("npx", ["tsx", "src/db/migrate.ts"], app, env);
  check("migrations apply to a fresh database", migrated.code === 0, `exit=${migrated.code}`);
  if (migrated.code !== 0) throw new Error("fixture migration failed; raw output suppressed");

  const provisioned = await run("npx", ["tsx", "-e", `
    import { getDb } from "./src/db/index.ts";
    import { users } from "./src/db/schema.ts";
    import { hashPassword } from "./src/lib/password.ts";
    (async () => {
      const db = await getDb();
      await db.insert(users).values({
        id: process.env.VERIFY_OPERATOR_ID,
        email: process.env.VERIFY_OPERATOR_EMAIL,
        passwordHash: await hashPassword(process.env.VERIFY_OPERATOR_PASSWORD!),
      });
      process.exit(0);
    })().catch(() => { console.error("admin_fixture_provision_failed"); process.exit(1); });
  `], app, env);
  check("local admin fixture is provisioned before server startup", provisioned.code === 0);
  if (provisioned.code !== 0) throw new Error("admin fixture provisioning failed; raw output suppressed");

  server = spawn(process.execPath, [path.join(REPO, "node_modules/next/dist/bin/next"), "dev", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
    cwd: app,
    env: { ...process.env, ...env },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (c) => (serverLog += c));
  server.stderr?.on("data", (c) => (serverLog += c));
  server.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`[server] exited with ${code}`);
  });

  try {
    await waitFor(
      async () => (await fetch(`${BASE}/`, { redirect: "manual", signal: AbortSignal.timeout(5000) })).status === 200,
      180_000,
      "the dev server to answer on /",
    );
  } catch (error) {
    // Without this the failure is just "timed out", which says nothing about
    // why the server would not start.
    console.error("Server startup failed; raw fixture output suppressed to protect mail tokens.");
    throw error;
  }

  // -------------------------------------------------------------------------
  // Phase 1 — the anonymous HTTP path
  // -------------------------------------------------------------------------
  console.log("\n--- phase 1: anonymous HTTP ---");

  const listing = await get("/");
  check("the public listing renders the subscribe form", listing.body.includes('name="email"'));
  check(
    "no session cookie is set just by loading the listing",
    listing.setCookie.length === 0,
    listing.setCookie.length ? "unexpected Set-Cookie present" : "no Set-Cookie",
  );
  subscribeFields = actionFieldsFor(listing.body, 'name="source"');
  check(
    "the form posts a server action without JavaScript",
    Object.keys(subscribeFields).some((k) => k.startsWith("$ACTION")),
    Object.keys(subscribeFields).join(","),
  );

  const alice = email("alice");
  const first = await postSubscribe(alice, "198.51.100.1", "/");
  const firstStatus = statusBlock(first.body);
  check("an anonymous visitor (no cookie) can subscribe", first.res.status === 200 && firstStatus !== "", `HTTP ${first.res.status}`);

  // The honest-copy rule. With no provider, the page may not claim a send.
  const FORBIDDEN = ["已发送", "已发出", "邮件已发", "请查收"];
  const lied = FORBIDDEN.filter((phrase) => firstStatus.includes(phrase));
  check(
    "with no mail provider, the response does not claim the mail was sent",
    lied.length === 0,
    lied.length ? `found ${lied.join(" / ")}` : "none of " + FORBIDDEN.join(" / "),
  );
  check(
    "the response says the mail will follow once mail is wired up",
    firstStatus.includes("已登记") && firstStatus.includes("邮件服务接通后发出"),
    firstStatus.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 160),
  );
  // Printed raw as well: the acceptance criterion for the honest-copy rule is
  // "attach the HTML fragment", and a rendered fragment is the only form of
  // that claim nobody has to take on trust.
  console.log(`      rendered HTML: ${firstStatus}`);

  check(
    "the log driver reports the mail as NOT DELIVERED",
    serverLog.includes("NOT DELIVERED") && serverLog.includes(`to:      ${alice}`),
  );

  const aliceConfirmLinks = loggedLinks("confirm", alice);
  const aliceUnsubLinks = loggedLinks("unsubscribe", alice);
  check("the log driver writes a usable confirm link", aliceConfirmLinks.length === 1, aliceConfirmLinks[0] ? "confirm link captured (redacted)" : "none");
  check(
    "the confirmation mail also carries a one-click unsubscribe link",
    aliceUnsubLinks.length === 1,
    aliceUnsubLinks[0] ? "unsubscribe link captured (redacted)" : "none",
  );

  // --- server-side validation, with the browser's hints bypassed ------------
  const invalidEmail = await postSubscribe("not-an-email", "198.51.100.2");
  check(
    "the server rejects a malformed address even though the POST skipped the form",
    errorText(invalidEmail.body).includes("邮箱格式"),
    errorText(invalidEmail.body) || statusBlock(invalidEmail.body),
  );

  // --- confirm: once, and only once ----------------------------------------
  const confirmUrl = aliceConfirmLinks[0]!;
  const confirmed = await get(new URL(confirmUrl).pathname + new URL(confirmUrl).search);
  check("the confirm link confirms the subscription", confirmed.body.includes("订阅已确认"));
  check(
    "confirming creates no session (it is not a login)",
    confirmed.setCookie.length === 0,
    confirmed.setCookie.length ? "unexpected Set-Cookie present" : "no Set-Cookie",
  );

  const replayed = await get(new URL(confirmUrl).pathname + new URL(confirmUrl).search);
  check(
    "the same confirm link cannot be used twice",
    replayed.body.includes("链接无效或已被使用") && !replayed.body.includes("订阅已确认"),
  );

  const bogusConfirm = await get("/subscribe/confirm?token=definitely-not-a-token");
  check("an unknown confirm token is refused", bogusConfirm.body.includes("链接无效或已被使用"));

  // --- email enumeration ---------------------------------------------------
  // `alice` is confirmed by now; `carol` has never been seen. If the two
  // responses differ in any way, this form answers "does this person use the
  // site?" for any address a stranger types.
  const carol = email("carol");
  const againConfirmed = await postSubscribe(alice, "198.51.100.3");
  const brandNew = await postSubscribe(carol, "198.51.100.4");
  check(
    "re-submitting a CONFIRMED address returns exactly the first-time response",
    statusBlock(againConfirmed.body) === statusBlock(brandNew.body) &&
      againConfirmed.res.status === brandNew.res.status,
    `confirmed: ${statusBlock(againConfirmed.body).replace(/<[^>]+>/g, "")} || new: ${statusBlock(brandNew.body).replace(/<[^>]+>/g, "")}`,
  );
  check(
    "no confirmation mail is sent for an already-confirmed address",
    loggedLinks("confirm", alice).length === 1,
    `${loggedLinks("confirm", alice).length} confirm mail(s) logged for alice in total`,
  );

  const bob = email("bob");
  const bob1 = await postSubscribe(bob, "198.51.100.5");
  const bob2 = await postSubscribe(bob, "198.51.100.6");
  check(
    "re-submitting a PENDING address returns exactly the first-time response",
    statusBlock(bob1.body) === statusBlock(bob2.body),
    statusBlock(bob1.body).replace(/<[^>]+>/g, ""),
  );
  check(
    "a re-submission issues a fresh confirm link rather than resending the old one",
    (() => {
      const links = loggedLinks("confirm", bob);
      return links.length === 2 && tokenOf(links[0]) !== tokenOf(links[1]);
    })(),
    loggedLinks("confirm", bob).length + " confirm mail(s) logged for bob",
  );

  // --- unsubscribe: one step, no login -------------------------------------
  const unsubUrl = aliceUnsubLinks[0]!;
  const unsubPath = new URL(unsubUrl).pathname + new URL(unsubUrl).search;
  const unsubscribed = await get(unsubPath);
  check(
    "the unsubscribe link takes effect in one step with no session",
    unsubscribed.res.status === 200 &&
      unsubscribed.body.includes("已退订") &&
      unsubscribed.setCookie.length === 0,
  );
  const unsubAgain = await get(unsubPath);
  check("clicking unsubscribe again is not an error", unsubAgain.body.includes("已退订"));

  const bogusUnsub = await get("/subscribe/unsubscribe?token=definitely-not-a-token");
  check("an unknown unsubscribe token is refused", bogusUnsub.body.includes("退订链接无效"));

  // --- re-subscribing after unsubscribing ----------------------------------
  const resub = await postSubscribe(alice, "198.51.100.7");
  check(
    "an unsubscribed address may subscribe again",
    statusBlock(resub.body) === firstStatus,
    statusBlock(resub.body).replace(/<[^>]+>/g, ""),
  );
  check(
    "re-subscribing goes through double opt-in again",
    loggedLinks("confirm", alice).length === 2,
    `${loggedLinks("confirm", alice).length} confirm mail(s) logged for alice`,
  );

  // --- rate limiting --------------------------------------------------------
  // Keyed on the address, three per hour. Different source IP each time, so the
  // IP budget cannot be what trips.
  const flooded = email("flood-target");
  const perEmail: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await postSubscribe(flooded, `203.0.113.${10 + i}`);
    perEmail.push(errorText(r.body) || "accepted");
  }
  check(
    "a 4th submission of the same address within the hour is throttled",
    perEmail.slice(0, 3).every((m) => m === "accepted") && perEmail[3].includes("提交过于频繁"),
    perEmail.join(" | "),
  );

  // Keyed on the IP, ten per hour, each with a different address.
  const perIp: string[] = [];
  for (let i = 0; i < 11; i++) {
    const r = await postSubscribe(email(`ipflood-${i}`), "203.0.113.200");
    perIp.push(errorText(r.body) || "accepted");
  }
  check(
    "an 11th submission from the same IP within the hour is throttled",
    perIp.slice(0, 10).every((m) => m === "accepted") && perIp[10].includes("提交过于频繁"),
    `first 10: ${new Set(perIp.slice(0, 10)).size === 1 ? perIp[0] : perIp.slice(0, 10).join(",")} | 11th: ${perIp[10]}`,
  );

  // Harvest one token that is never spent, for the expiry check in phase 2.
  const dave = email("dave");
  await postSubscribe(dave, "198.51.100.8");
  const daveConfirm = loggedLinks("confirm", dave)[0];
  check("a token is available for the expiry check", Boolean(daveConfirm), daveConfirm ? "expiry link captured (redacted)" : "none");

  // -------------------------------------------------------------------------
  // Phase 1b — the /admin read-only subscriber view
  // -------------------------------------------------------------------------
  console.log("\n--- phase 1b: the /admin subscriber view ---");

  // Two rows that then stay put, so the distribution has something in every
  // bucket: erin confirms and stays confirmed, frank unsubscribes and stays out.
  const erin = email("erin");
  await postSubscribe(erin, "198.51.100.20");
  await get(pathOf(loggedLinks("confirm", erin)[0]!));
  const frank = email("frank");
  await postSubscribe(frank, "198.51.100.21");
  await get(pathOf(loggedLinks("unsubscribe", frank)[0]!));

  const anonymousAdmin = await get("/admin/subscribers");
  check(
    "an anonymous visitor is redirected away from the subscriber view",
    [302, 303, 307].includes(anonymousAdmin.res.status) &&
      (anonymousAdmin.res.headers.get("location") ?? "").includes("/login"),
    `HTTP ${anonymousAdmin.res.status} → ${anonymousAdmin.res.headers.get("location")}`,
  );
  // The redirect status is not the claim. Before `requireUser()` was called in
  // the page body, this exact response was a 307 to /login whose *body* carried
  // the rendered page — every address included — because a layout's redirect
  // does not stop the page under it from rendering.
  const leaked = [...expectedStored].filter((address) => anonymousAdmin.body.includes(address));
  check(
    "and the body of that redirect contains no subscriber address",
    leaked.length === 0,
    leaked.length ? `leaked ${leaked.length}: ${leaked.slice(0, 2).join(", ")}` : `${anonymousAdmin.body.length}B, 0 of ${expectedStored.size} addresses`,
  );

  // Only the explicitly allowlisted pre-provisioned fixture may read admin data.
  const loginPage = await get("/login");
  const loginForm = new FormData();
  for (const [k, v] of Object.entries(actionFieldsFor(loginPage.body, 'name="password"'))) {
    loginForm.append(k, v);
  }
  loginForm.set("email", operator);
  loginForm.set("password", operatorPassword);
  const loggedIn = await fetch(`${BASE}/login`, {
    method: "POST",
    body: loginForm,
    redirect: "manual",
    headers: { origin: BASE },
  });
  const cookie = (loggedIn.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";")[0])
    .join("; ");
  check("the allowlisted local operator can log in", cookie.includes("aist_session="), `HTTP ${loggedIn.status}`);

  const adminView = await getAs("/admin/subscribers", cookie);
  const expectedTotal = expectedStored.size;
  check(
    "the subscriber view reports the total number of collected addresses",
    adminView.res.status === 200 && adminView.body.includes(`共 ${expectedTotal} 个邮箱`),
    `expected 共 ${expectedTotal} 个邮箱 (HTTP ${adminView.res.status})`,
  );

  const distribution = distributionOf(adminView.body);
  check(
    "the distribution matches what the flows actually did",
    distribution.confirmed === 1 &&
      distribution.unsubscribed === 1 &&
      distribution.pending === expectedTotal - 2,
    `待确认 ${distribution.pending} · 已确认 ${distribution.confirmed} · 已退订 ${distribution.unsubscribed}`,
  );
  check(
    "a confirmed and an unsubscribed address are each shown with their own state",
    adminView.body.includes(erin) && adminView.body.includes(frank),
  );

  // The point of the finalized decision is that `pending` is the resting state.
  // The page has to say so in a way that does not read as a malfunction.
  check(
    "the view explains that pending is the expected state, not a failure",
    adminView.body.includes("这是预期结果") && adminView.body.includes("不是故障"),
  );
  check(
    "the view names the driver that is actually in use",
    adminView.body.includes("日志默认隐藏邮箱和确认链接") && adminView.body.includes(">log<"),
  );

  // Read-only, structurally: the layout's logout form and its button are the
  // only ones on the page. No "mark as confirmed", because nobody clicked
  // anything.
  const adminForms = adminView.body.match(/<form[\s\S]*?<\/form>/g) ?? [];
  const adminButtons = adminView.body.match(/<button[\s\S]*?<\/button>/g) ?? [];
  check(
    "the subscriber view is strictly read-only — the only form and button are 登出",
    adminForms.length === 1 &&
      adminForms[0].includes("登出") &&
      adminButtons.length === 1 &&
      adminButtons[0].includes("登出"),
    `${adminForms.length} form(s), ${adminButtons.length} button(s)`,
  );

  const frankDigest = sha256(tokenOf(loggedLinks("unsubscribe", frank)[0]!));
  check(
    "the view renders no token digest",
    !adminView.body.includes(frankDigest),
    "digest checked without printing it",
  );

  const dashboard = await getAs("/admin", cookie);
  check(
    "the /admin dashboard carries the same total and the real mail driver",
    dashboard.body.includes(`共 ${expectedTotal} 个邮箱`) &&
      dashboard.body.includes("只写日志，不发信"),
  );

  // -------------------------------------------------------------------------
  // Phase 2 — direct, after the server releases the database
  // -------------------------------------------------------------------------
  console.log("\n--- phase 2: database and store, server stopped ---");

  signalServer("SIGTERM");
  await new Promise<void>((resolve) => {
    server!.once("exit", () => resolve());
    setTimeout(() => {
      signalServer("SIGKILL");
      resolve();
    }, 15_000);
  });
  // PGlite holds a lock file until the process is gone.
  await new Promise((r) => setTimeout(r, 1500));

  process.env.PGLITE_DATA_DIR = dataDir;
  delete process.env.DATABASE_URL;
  const { getDb } = await import("../src/db/index.ts");
  const { sql } = await import("drizzle-orm");
  const store = await import("../src/lib/subscribe/store.ts");
  const db = await getDb();

  const rowOf = async (address: string) => {
    const result = await db.execute<{
      email: string;
      status: string;
      source: string;
      confirm_token_hash: string | null;
      unsub_token_hash: string;
      confirmed_at: Date | null;
      unsubscribed_at: Date | null;
    }>(sql`select email, status, source, confirm_token_hash, unsub_token_hash, confirmed_at,
                   unsubscribed_at
            from subscriber where email = ${address}`);
    return result.rows.at(0);
  };

  const bobRow = await rowOf(bob);
  check(
    "an unconfirmed submission is stored as pending, with a source and a live token",
    bobRow?.status === "pending" &&
      bobRow.source === "/" &&
      bobRow.confirm_token_hash !== null &&
      bobRow.confirmed_at === null,
    JSON.stringify(bobRow && { status: bobRow.status, source: bobRow.source }),
  );

  const aliceRow = await rowOf(alice);
  check(
    "the re-subscribed address is back to pending, not confirmed",
    aliceRow?.status === "pending" && aliceRow.confirmed_at === null,
    `status=${aliceRow?.status}`,
  );

  // The raw token travelled by email; only its digest may be in the database.
  // Bob's latest token is the one still live — alice's were all spent.
  const rawConfirmToken = tokenOf(loggedLinks("confirm", bob).at(-1)!);
  const rawMatch = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from subscriber
        where confirm_token_hash = ${rawConfirmToken} or unsub_token_hash = ${rawConfirmToken}`,
  );
  check("no raw token is stored anywhere in the table", rawMatch.rows[0]?.n === 0);
  const digestMatch = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from subscriber where confirm_token_hash = ${sha256(rawConfirmToken)}`,
  );
  check("the stored value is the SHA-256 digest of the mailed token", digestMatch.rows[0]?.n === 1);

  // The address that unsubscribed must not be selectable for any send.
  const mailable = await store.listMailableSubscribers();
  const mailableAddresses = mailable.map((m) => m.email);
  check(
    "listMailableSubscribers() excludes the unsubscribed address",
    !mailableAddresses.includes(alice),
    `${mailable.length} mailable row(s)`,
  );
  check(
    "listMailableSubscribers() excludes every pending address",
    !mailableAddresses.includes(bob) && !mailableAddresses.includes(carol),
  );

  const unsubbedCount = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from subscriber where status = 'unsubscribed'
        and (unsubscribed_at is null or confirm_token_hash is not null)`,
  );
  check(
    "every unsubscribed row has a timestamp and no live confirm token",
    unsubbedCount.rows[0]?.n === 0,
  );

  // --- expiry ---------------------------------------------------------------
  const daveToken = tokenOf(daveConfirm!);
  await db.execute(
    sql`update subscriber set confirm_token_expires_at = now() - interval '1 day'
        where email = ${dave}`,
  );
  const expired = await store.confirmSubscription(daveToken);
  check("a token past its expiry is refused", expired.kind === "expired", `kind=${expired.kind}`);
  const daveRow = await rowOf(dave);
  check("an expired confirm attempt leaves the row pending", daveRow?.status === "pending", `status=${daveRow?.status}`);

  // And once it is back in date, the same token works — i.e. what was refused
  // was the expiry, not the token.
  await db.execute(
    sql`update subscriber set confirm_token_expires_at = now() + interval '1 day'
        where email = ${dave}`,
  );
  const revived = await store.confirmSubscription(daveToken);
  check("the same token works once it is in date again", revived.kind === "confirmed", `kind=${revived.kind}`);
  const spentAgain = await store.confirmSubscription(daveToken);
  check("and is spent after that one use", spentAgain.kind === "invalid", `kind=${spentAgain.kind}`);

  // --- throttle rows are counters, not a list of addresses ------------------
  const throttle = await db.execute<{ scope: string; key_hash: string; count: number }>(
    sql`select scope, key_hash, count from subscribe_throttle order by count desc limit 3`,
  );
  const storesPlaintext = throttle.rows.some((r) => r.key_hash.includes("@"));
  check(
    "the throttle table stores digests, not addresses or IPs",
    !storesPlaintext && throttle.rows.every((r) => /^[0-9a-f]{64}$/.test(r.key_hash)),
    throttle.rows.map((r) => `${r.scope}:${r.count}`).join(" "),
  );

  // --- what the admin view reads -------------------------------------------
  const adminCounts = await store.countSubscribersByStatus();
  const grouped = await db.execute<{ status: string; n: number }>(
    sql`select status, count(*)::int as n from subscriber group by status`,
  );
  const fromSql = Object.fromEntries(grouped.rows.map((r) => [r.status, r.n]));
  check(
    "countSubscribersByStatus() matches a direct GROUP BY and zero-fills the rest",
    Object.entries(adminCounts).every(([status, n]) => n === (fromSql[status] ?? 0)) &&
      Object.keys(adminCounts).length === 3,
    JSON.stringify(adminCounts),
  );
  check(
    "the counts cover every row in the table",
    Object.values(adminCounts).reduce((a, b) => a + b, 0) === expectedStored.size,
    `${Object.values(adminCounts).reduce((a, b) => a + b, 0)} counted vs ${expectedStored.size} accepted submissions`,
  );

  const adminRows = await store.listRecentSubscribers(5);
  check(
    "listRecentSubscribers() never selects a token column",
    adminRows.every((row) => !("confirmTokenHash" in row) && !("unsubTokenHash" in row)),
    Object.keys(adminRows[0] ?? {}).join(","),
  );
  check(
    "listRecentSubscribers() honours its limit and returns newest first",
    adminRows.length === 5 &&
      adminRows.every(
        (row, i) => i === 0 || row.createdAt <= adminRows[i - 1]!.createdAt,
      ),
    `${adminRows.length} row(s)`,
  );

  // The finalized decision, asserted against the data rather than the copy: no
  // address is `confirmed` unless a confirm token was actually spent for it.
  const confirmedRows = await db.execute<{ email: string }>(
    sql`select email from subscriber where status = 'confirmed'`,
  );
  const clicked = new Set([erin, dave]);
  check(
    "only addresses whose confirm link was actually visited are confirmed",
    confirmedRows.rows.every((row) => clicked.has(row.email)),
    confirmedRows.rows.map((r) => r.email.replace(`-${RUN}@example.com`, "")).join(", ") || "none",
  );
} finally {
  if (server && server.exitCode === null) signalServer("SIGKILL");
  // A just-killed Turbopack still has writes in flight, so the first rmdir can
  // lose a race with it. Retry rather than failing a passing run on cleanup.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(scratch, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

console.log(
  failures === 0 ? "\nAll subscription checks passed." : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
