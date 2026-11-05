/**
 * End-to-end check of the register / login / logout flow against a running
 * server. Start the app first, then:
 *
 *   npm run dev                       # or: npm run build && npm start
 *   npm run verify:auth               # override with BASE_URL=http://host:port
 *
 * It drives the real HTTP endpoints rather than calling the server actions
 * directly: React renders hidden `$ACTION_*` fields so forms work without
 * JavaScript, which is what lets plain fetch submit them. That means cookies,
 * redirects and session revocation are all exercised for real.
 *
 * Registers a unique throwaway email per run, so it is safe to re-run.
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(BASE).hostname)) {
  console.error("This mutating verification requires a local test server.");
  process.exit(1);
}
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
  const set = res.headers.getSetCookie?.() ?? [];
  for (const c of set) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (/expires=thu, 01 jan 1970/i.test(c) || /max-age=0/i.test(c) || value === "") {
      cookie = "";
    } else {
      cookie = `${name}=${value}`;
    }
  }
  return set;
}

async function get(path) {
  const res = await fetch(BASE + path, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  captureCookies(res);
  const body = await res.text();
  return { res, body };
}

/** Extracts the hidden server-action fields React renders for no-JS submits. */
function actionFields(html, formIndex = 0) {
  const forms = html.match(/<form[\s\S]*?<\/form>/g) ?? [];
  const form = forms[formIndex];
  if (!form) throw new Error(`no form at index ${formIndex}`);
  const fields = {};
  for (const m of form.matchAll(/<input([^>]*type="hidden"[^>]*)>/g)) {
    const name = m[1].match(/name="([^"]*)"/)?.[1];
    const value = m[1].match(/value="([^"]*)"/)?.[1] ?? "";
    if (name) fields[name] = unescapeHtml(value);
  }
  return fields;
}

async function postAction(path, fields, extra = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const res = await fetch(BASE + path, {
    method: "POST",
    body: fd,
    redirect: "manual",
    headers: { origin: BASE, ...(cookie ? { cookie } : {}) },
  });
  captureCookies(res);
  const body = await res.text();
  return { res, body };
}

function check(label, pass, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

/** Next replies to a server-action redirect with the target in a header or an RSC payload. */
function redirectTarget({ res, body }) {
  return (
    res.headers.get("location") ||
    res.headers.get("x-action-redirect") ||
    (body.match(/"(?:\/admin|\/account|\/login)"/)?.[0]?.replaceAll('"', "") ?? "")
  );
}

const EMAIL = `t2-${Date.now()}@example.com`;
const PASSWORD = "correct-horse-8";

// 1. /admin is gated before any login.
{
  const r = await get("/admin");
  check(
    "anonymous /admin redirects to /login",
    r.res.status === 307 && r.res.headers.get("location")?.endsWith("/login"),
    `status=${r.res.status} location=${r.res.headers.get("location")}`,
  );
}

// 2. Password shorter than the 8-char minimum is rejected.
{
  const { body } = await get("/register");
  const r = await postAction("/register", actionFields(body), {
    email: `short-${Date.now()}@example.com`,
    password: "abc",
  });
  check("short password rejected", r.body.includes("密码至少 8 位"), cookie ? "unexpected session present" : "no session");
  check("no session issued on invalid register", cookie === "");
}

// 3. Register succeeds and issues a session.
{
  const { body } = await get("/register");
  const r = await postAction("/register", actionFields(body), {
    email: EMAIL,
    password: PASSWORD,
  });
  check("ordinary signup redirects to /account", redirectTarget(r).split(";")[0] === "/account", redirectTarget(r));
  check("register sets session cookie", cookie.startsWith("aist_session="), "session value redacted");
}

// 4. A signed-in ordinary user has account access but no administrator access.
{
  const account = await get("/account");
  check("ordinary user reaches /account", account.res.status === 200, `status=${account.res.status}`);
  check("account shows the signed-in email", account.body.includes(EMAIL));
  for (const pathname of ["/admin", "/admin/records", "/admin/records/new", "/admin/subscribers", "/admin/records/00000000-0000-4000-8000-000000000000"]) {
    const page = await get(pathname);
    check(`ordinary user cannot read ${pathname}`,
      [302, 303, 307, 308].includes(page.res.status) &&
        (page.res.headers.get("location") ?? "").split(";")[0] === "/account",
      `status=${page.res.status}`);
    check(`denial for ${pathname} leaks no admin controls`,
      !page.body.includes('name="company.slug"') && !page.body.includes("订阅分布") &&
        !page.body.includes("已存来源（"));
  }
}

// 5. Logging out clears the cookie and the row.
let sessionCookieBeforeLogout = cookie;
{
  const { body } = await get("/account");
  const forms = body.match(/<form[\s\S]*?<\/form>/g) ?? [];
  const logoutIndex = forms.findIndex((form) => form.includes("登出"));
  if (logoutIndex < 0) throw new Error("Account page must expose a logout form.");
  const r = await postAction("/account", actionFields(body, logoutIndex));
  check("logout redirects to /login", redirectTarget(r) === "/login", redirectTarget(r));
  check("logout clears cookie", cookie === "", cookie ? "session still present" : "session cleared");
}

// 6. The old token must not work again — proves server-side revocation.
{
  const saved = cookie;
  cookie = sessionCookieBeforeLogout;
  const r = await get("/account");
  check(
    "revoked session token is rejected",
    r.res.status === 307 && (r.res.headers.get("location") ?? "").includes("/login"),
    `status=${r.res.status}`,
  );
  cookie = saved;
}

// 7. Wrong password is refused.
{
  cookie = "";
  const { body } = await get("/login");
  const r = await postAction("/login", actionFields(body), {
    email: EMAIL,
    password: "wrong-password-9",
  });
  check("wrong password refused", r.body.includes("邮箱或密码不正确"));
  check("no session issued on bad login", cookie === "");
}

// 8. Unknown email gives the same message (no account enumeration).
{
  cookie = "";
  const { body } = await get("/login");
  const r = await postAction("/login", actionFields(body), {
    email: `nobody-${Date.now()}@example.com`,
    password: PASSWORD,
  });
  check("unknown email gives identical message", r.body.includes("邮箱或密码不正确"));
}

// 9. Correct credentials log back in.
{
  cookie = "";
  const { body } = await get("/login");
  const r = await postAction("/login", actionFields(body), {
    email: EMAIL,
    password: PASSWORD,
  });
  check("ordinary login redirects to /account", redirectTarget(r).split(";")[0] === "/account", redirectTarget(r));
  check("login sets session cookie", cookie.startsWith("aist_session="));
  const account = await get("/account");
  check("re-login reaches /account", account.res.status === 200, `status=${account.res.status}`);
}

const ordinaryCookie = cookie;

// 10. Email is unique, case-insensitively.
{
  cookie = "";
  const { body } = await get("/register");
  const r = await postAction("/register", actionFields(body), {
    email: EMAIL.toUpperCase(),
    password: PASSWORD,
  });
  check("duplicate email rejected case-insensitively", r.body.includes("该邮箱已注册"));
}

// 11. Capturing a valid action ID must not let an ordinary account mutate records.
const adminEmail = process.env.ADMIN_TEST_EMAIL;
const adminPassword = process.env.ADMIN_TEST_PASSWORD;
if (adminEmail && adminPassword) {
  cookie = "";
  const login = await get("/login");
  await postAction("/login", actionFields(login.body), { email: adminEmail, password: adminPassword });
  const editor = await get("/admin/records/new");
  check("allowlisted fixture can supply an admin action", editor.res.status === 200);
  if (editor.res.status === 200) {
    const forms = editor.body.match(/<form[\s\S]*?<\/form>/g) ?? [];
    const editorIndex = forms.findIndex((form) => form.includes('name="company.slug"'));
    if (editorIndex < 0) throw new Error("Admin fixture did not receive a record editor form.");
    const captured = actionFields(editor.body, editorIndex);
    cookie = ordinaryCookie;
    const replay = await postAction("/admin/records/new", captured, {
      "company.slug": `denied-write-${Date.now()}`,
      "company.name": "Unauthorized write fixture",
      "company.countryCode": "US",
      "company.industry": "other",
      "impact.impactType": "mentioned_in_coverage",
      "impact.attributionConfidence": "low",
      "impact.outcome": "downsizing_announced",
      "impact.eventDate": "2026-01-01",
      "impact.summary": "Local authorization fixture that must never become a stored record.",
      "sources.0.url": "https://example.com/authorization-fixture",
      "sources.0.mediaName": "Local fixture",
      "sources.0.sourceType": "other",
      "sources.0.publishedAt": "2026-01-01",
      "sources.0.quote": "An authorization fixture with a sufficiently long source excerpt.",
      "status": "draft",
    });
    check("ordinary user cannot invoke a captured admin mutation",
      ([302, 303, 307, 308].includes(replay.res.status) ||
        (replay.res.status < 400 && Boolean(replay.res.headers.get("x-action-redirect")))) &&
        redirectTarget(replay).split(";")[0] === "/account" &&
        !/\/admin\/records\/[0-9a-f-]{36}/.test(redirectTarget(replay)),
      `status=${replay.res.status}`);
  }
} else {
  console.log("SKIP  captured admin action replay requires ADMIN_TEST_EMAIL and ADMIN_TEST_PASSWORD");
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
