/** Capture public pages and the free account flow on a local test server. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(BASE).hostname), "Account creation captures require a local target");
const OUT = join("docs", "acceptance", "local");
await mkdir(OUT, { recursive: true });
const email = `capture-${Date.now()}-${randomBytes(4).toString("hex")}@example.com`;
const password = randomBytes(24).toString("base64url");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
  const page = await context.newPage();
  const capture = async (path, name) => {
    const response = await page.goto(BASE + path, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200, path);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  };
  for (const [path, name] of [["/", "01-shutdowns"], ["/shutdown/nintee", "02-shutdown-detail"], ["/impact", "03-impact"], ["/stats", "04-stats"]]) {
    await capture(path, name);
  }
  // Capture authentication forms before entering credentials, never after.
  await capture("/register", "05-register");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((url) => url.pathname === "/account"), page.getByRole("button", { name: "注册" }).click()]);
  await page.getByRole("button", { name: "登出" }).click();
  await capture("/login", "06-login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((url) => url.pathname === "/account"), page.getByRole("button", { name: "登录" }).click()]);
  await capture("/account", "07-free-account");
  const response = await context.request.get(BASE + "/api/export/records");
  assert.equal(response.status(), 200, "Regular account CSV export");
  await writeFile(join(OUT, "08-export-head.csv"), (await response.text()).split("\n").slice(0, 4).join("\n") + "\n");
  console.log("Captured public pages and free account export locally. Keep generated account artifacts private.");
} finally {
  await browser.close();
}
