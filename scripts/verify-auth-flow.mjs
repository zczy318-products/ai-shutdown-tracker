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
 *
 * Scope note (ZCZ-15): registering produces a `viewer`, and a viewer has no
 * write access, so this script stops at the session — it checks that the
 * session is issued, honoured, revoked on logout and refused afterwards, with
 * `/account` as the page a session gets you. Everything about the role itself
 * — that /admin refuses a viewer, that the five write actions refuse one, that
 * an editor can still do all of it — lives in `npm run verify:roles`, which
 * owns its own database and can therefore grant the role.
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
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
    headers: cookie ? { cookie } : {},
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
    (body.match(/"(?:\/account|\/admin|\/login)"/)?.[0]?.replaceAll('"', "") ?? "")
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
  check("short password rejected", r.body.includes("密码至少 8 位"), `cookie=${cookie || "(none)"}`);
  check("no session issued on invalid register", cookie === "");
}

// 3. Register succeeds and issues a session.
{
  const { body } = await get("/register");
  const r = await postAction("/register", actionFields(body), {
    email: EMAIL,
    password: PASSWORD,
  });
  // /account, not /admin: a new account is a viewer, and /admin would refuse
  // it. What registering gets you is the account page (ZCZ-15).
  check("register redirects to /account", redirectTarget(r) === "/account", redirectTarget(r));
  check("register sets session cookie", cookie.startsWith("aist_session="), cookie.slice(0, 24));
}

// 4. The session actually grants the page a session is for.
{
  const r = await get("/account");
  check("/account reachable when logged in", r.res.status === 200, `status=${r.res.status}`);
  check("/account shows the signed-in email", r.body.includes(EMAIL));
  check(
    "and says what this account may do",
    r.body.includes('data-role="viewer"'),
    r.body.match(/data-role="([a-z]*)"/)?.[1] ?? "no data-role",
  );
}

// 4b. /admin is not what a session gets you. The refusal is a role refusal, so
// it goes to /account — a signed-in visitor sent to /login learns nothing.
{
  const r = await get("/admin");
  const location = r.res.headers.get("location") ?? "";
  check(
    "a viewer is refused by /admin",
    r.res.status === 307 && location.startsWith("/account"),
    `status=${r.res.status} location=${location}`,
  );
  check("and is not bounced to /login", !location.includes("/login"), location);
}

// 5. Logging out clears the cookie and the row.
let sessionCookieBeforeLogout = cookie;
{
  // The logout form on /account — the one a viewer can actually reach.
  const { body } = await get("/account");
  const logoutForm = (body.match(/<form[\s\S]*?<\/form>/g) ?? []).findIndex((f) =>
    f.includes("登出"),
  );
  check("/account renders a logout control", logoutForm >= 0, `form index ${logoutForm}`);
  const r = await postAction("/account", actionFields(body, logoutForm));
  check("logout redirects to /login", redirectTarget(r) === "/login", redirectTarget(r));
  check("logout clears cookie", cookie === "", `cookie=${cookie || "(cleared)"}`);
}

// 6. The old token must not work again — proves server-side revocation.
{
  const saved = cookie;
  cookie = sessionCookieBeforeLogout;
  const r = await get("/account");
  check(
    "revoked session token is rejected",
    r.res.status === 307,
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
  // By role: a viewer lands on /account. `verify:roles` covers the other half
  // of this split — an editor lands on /admin.
  check("login redirects to /account", redirectTarget(r) === "/account", redirectTarget(r));
  check("login sets session cookie", cookie.startsWith("aist_session="));
  const account = await get("/account");
  check("re-login reaches /account", account.res.status === 200, `status=${account.res.status}`);
}

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

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
