/** Local HTTP regression for free account exports and owner-scoped API keys. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(BASE).hostname), "Account creation checks require a local target");
const stamp = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const password = randomBytes(24).toString("base64url");
let cookie = "";
let checks = 0;
function check(label, condition) { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); }
const visible = (html) => html.replaceAll("<!-- -->", "");
const decode = (text) => text.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
function cookies(response) {
  for (const item of response.headers.getSetCookie()) {
    const pair = item.split(";")[0];
    if (pair.startsWith("aist_session=")) cookie = pair;
  }
}
async function get(path, useCookie = true, extra = {}) {
  const res = await fetch(BASE + path, { redirect: "manual", headers: { ...(useCookie && cookie ? { cookie } : {}), ...extra } });
  cookies(res);
  return { res, body: visible(await res.text()) };
}
function actionFields(html, marker) {
  const form = (html.match(/<form\b[\s\S]*?<\/form>/g) ?? []).find((item) => item.includes(marker));
  assert.ok(form, `Expected action form: ${marker}`);
  const fields = {};
  for (const input of form.matchAll(/<input\b([^>]*)>/g)) {
    if (!/type="hidden"/.test(input[1])) continue;
    const name = input[1].match(/name="([^"]+)"/)?.[1];
    if (name) fields[decode(name)] = decode(input[1].match(/value="([^"]*)"/)?.[1] ?? "");
  }
  return fields;
}
async function post(path, fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const res = await fetch(BASE + path, { method: "POST", redirect: "manual", body: form,
    headers: { origin: BASE, ...(cookie ? { cookie } : {}) } });
  cookies(res);
  return { res, body: visible(await res.text()) };
}
async function register(suffix) {
  cookie = "";
  const page = await get("/register");
  const response = await post("/register", { ...actionFields(page.body, 'name="email"'), email: `free-${stamp}-${suffix}@example.com`, password });
  check("Registration creates a regular signed-in account", Boolean(cookie) && response.res.status < 400);
  check("Registration opens the account page", (response.res.headers.get("location") ?? "").includes("/account"));
}

check("Anonymous homepage is public", (await get("/", false)).res.status === 200);
const accountAnonymous = await get("/account", false);
check("Anonymous account page requires login", accountAnonymous.res.status === 307 && (accountAnonymous.res.headers.get("location") ?? "").includes("/login"));
const anonymousBrowser = await get("/api/export/records", false, { accept: "text/html" });
check("Anonymous CSV browser request goes to login", anonymousBrowser.res.status === 303 && (anonymousBrowser.res.headers.get("location") ?? "").includes("/login"));
const anonymousScript = await get("/api/export/records", false, { accept: "application/json" });
check("Anonymous CSV script request receives 401", anonymousScript.res.status === 401 && JSON.parse(anonymousScript.body).error === "account_required");
check("Pricing route is removed", (await get("/pricing", false)).res.status === 404);
check("Payment webhook is removed", (await fetch(BASE + "/api/billing/webhook", { method: "POST" })).status === 404);

await register("owner");
const ownerCookie = cookie;
let ownerPage = await get("/account");
check("Account shows its own UUID", /data-user-id="[0-9a-f-]{36}"/.test(ownerPage.body));
check("Regular account has no admin link", !/href="\/admin"/.test(ownerPage.body));
check("Account has no upgrade UI", !/href="\/pricing"|专业版|套餐变更|模拟升级/.test(ownerPage.body));
check("Account explains free access", ownerPage.body.includes("免费"));
const csvResponse = await fetch(BASE + "/api/export/records", { headers: { cookie } });
const csvBytes = Buffer.from(await csvResponse.arrayBuffer());
const csv = csvBytes.toString("utf8");
check("New account downloads CSV without any plan change", csvResponse.status === 200 && (csvResponse.headers.get("content-type") ?? "").includes("text/csv"));
check("CSV keeps the UTF-8 BOM", csvBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
check("CSV carries source and attribution columns", ["source_url", "source_quote", "attribution_confidence"].every((name) => csv.split("\r\n")[0].includes(name)));
check("CSV includes published source data", Number(csvResponse.headers.get("x-record-count")) > 0 && /https?:\/\//.test(csv));

const keyName = `owner-key-${stamp}`;
const issued = await post("/account", { ...actionFields(ownerPage.body, 'name="name"'), name: keyName });
const token = issued.body.match(/rip_[A-Za-z0-9_-]{40,}/)?.[0];
check("Regular account creates an API key for free", Boolean(token));
ownerPage = await get("/account");
check("Key plaintext is not shown again", !ownerPage.body.includes(token));
const keyId = ownerPage.body.match(/name="keyId" value="([0-9a-f-]{36})"/)?.[1];
check("Owner can manage the new key", Boolean(keyId) && ownerPage.body.includes(keyName));
const revokeFields = actionFields(ownerPage.body, `value="${keyId}"`);
const issueFields = actionFields(ownerPage.body, 'name="name"');
const concurrentIssues = await Promise.all(Array.from({ length: 5 }, (_, index) => post("/account", {
  ...issueFields, name: `parallel-${stamp}-${index}`,
})));
check("Concurrent issuance respects the five-active-key cap", concurrentIssues.filter((result) => /rip_[A-Za-z0-9_-]{40,}/.test(result.body)).length === 4);

const call = await fetch(BASE + "/api/v1/records?limit=3", { headers: { authorization: `Bearer ${token}` } });
const payload = await call.json();
check("Free API key reads published JSON", call.status === 200 && payload.records.length > 0);
check("JSON retains evidence qualifiers", payload.records.every((record) => record.attributionConfidence && record.sources.length && record.sources.every((source) => source.url && source.quote)));
check("API remains read-only", (await fetch(BASE + "/api/v1/records", { method: "POST", headers: { authorization: `Bearer ${token}` } })).status === 405);
check("Free API key downloads CSV", (await fetch(BASE + "/api/export/records", { headers: { "x-api-key": token } })).status === 200);
check("Invalid explicit key cannot fall back to a valid session", (await fetch(BASE + "/api/export/records", { headers: { cookie, "x-api-key": "invalid-explicit-key" } })).status === 401);
check("Empty explicit key cannot fall back to a valid session", (await fetch(BASE + "/api/export/records", { headers: { cookie, "x-api-key": "" } })).status === 401);

await register("other");
const otherPage = await get("/account");
check("Another account cannot list the owner's key", !otherPage.body.includes(keyName) && !otherPage.body.includes(keyId));
await post("/account", { ...revokeFields, keyId });
check("Another account cannot revoke the owner's key", (await fetch(BASE + "/api/v1/records", { headers: { authorization: `Bearer ${token}` } })).status === 200);
cookie = ownerCookie;
await post("/account", { ...revokeFields, keyId });
const revoked = await fetch(BASE + "/api/v1/records", { headers: { authorization: `Bearer ${token}` } });
check("Owner revocation immediately disables JSON access", revoked.status === 401 && (await revoked.json()).error === "revoked_key");
check("Owner revocation immediately disables CSV access", (await fetch(BASE + "/api/export/records", { headers: { "x-api-key": token } })).status === 401);
console.log(`All ${checks} free-account/API checks passed. Temporary accounts remain only in the local test database.`);
