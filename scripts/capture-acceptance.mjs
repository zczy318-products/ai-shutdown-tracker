#!/usr/bin/env node
/**
 * Captures the acceptance walkthrough screenshots into docs/acceptance/.
 *
 *   npm run capture:acceptance                      # against http://localhost:3000
 *   BASE_URL=https://<project>.vercel.app npm run capture:acceptance
 *
 * Start the target server first (`npm run dev`, or point BASE_URL at the
 * deployment). Re-runnable: each run registers a fresh timestamped account, so
 * it never collides with rows left behind by a previous run.
 *
 * Steps 03-08 are declared here but skipped until T5/T6 ship the routes they
 * shoot. They are listed rather than omitted so the acceptance doc and this
 * script cannot drift apart — a skip prints a line saying what it is waiting on.
 *
 * Browser setup: `npx playwright install --with-deps chromium`. In a sandbox
 * without root, see docs/ACCEPTANCE.md §1 for the rootless equivalent (the
 * shared libraries and the CJK font both have to be provided, or Chinese text
 * renders as tofu boxes).
 */
import { mkdir, readdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs", "acceptance");
const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const VIEWPORT = { width: 1280, height: 900 };

/** Unique per run so the script stays re-runnable against a persisted database. */
const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const account = { email: `acceptance+${stamp}@example.com`, password: "acceptance-demo-pw" };

async function shoot(page, name) {
  // The Next.js dev-tools badge floats over every page in `npm run dev` and is
  // pure noise in an acceptance screenshot. No-op against a production build.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`  captured docs/acceptance/${name}.png`);
}

/** Steps that have routes today. Each returns after leaving the page shot. */
const steps = [
  {
    id: "01-register",
    title: "注册",
    async run(page) {
      await page.goto(`${BASE_URL}/register`, { waitUntil: "networkidle" });
      await page.fill("#email", account.email);
      await page.fill("#password", account.password);
      // Shoot the filled form *before* submitting: the point of this shot is
      // that a human can see what was entered.
      await shoot(page, "01-register");
      await Promise.all([
        page.waitForURL((url) => !url.pathname.startsWith("/register"), { timeout: 30_000 }),
        page.click('button[type="submit"]'),
      ]);
      await page.waitForLoadState("networkidle");
      await shoot(page, "01b-register-success");
    },
  },
  {
    id: "02-login",
    title: "登录",
    async run(page) {
      // Drop the session the registration just created, so this really exercises
      // the login path rather than redirecting an already-authenticated user.
      await page.context().clearCookies();
      await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
      await page.fill("#email", account.email);
      await page.fill("#password", account.password);
      await shoot(page, "02-login");
      await Promise.all([
        page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 }),
        page.click('button[type="submit"]'),
      ]);
      await page.waitForLoadState("networkidle");
      // Login lands on /admin, which 01b already shows. The signed-in home page
      // is the shot that actually evidences the session (it names the user).
      await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
      await shoot(page, "02b-signed-in-home");
    },
  },
];

/** Not yet shootable. Kept visible so the gap is reported, not silently missing. */
const pending = [
  { id: "03-list", title: "浏览榜单", blockedOn: "T5 榜单页" },
  { id: "04-filter", title: "筛选", blockedOn: "T5 筛选" },
  { id: "05-detail", title: "公司详情（来源链接 + 原文引述）", blockedOn: "T5 详情页" },
  { id: "06-dashboard", title: "统计仪表盘", blockedOn: "T5 仪表盘" },
  { id: "07-upgrade", title: "升级到付费（Stripe 测试模式）", blockedOn: "T6 SaaS 层" },
  { id: "08-export", title: "导出 CSV", blockedOn: "T6 CSV 导出" },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // Clear previously captured shots for the steps we are about to re-take, so a
  // stale image can never be mistaken for a fresh one.
  const existing = await readdir(OUT_DIR).catch(() => []);
  const retaking = new Set(steps.map((s) => s.id.slice(0, 2)));
  for (const file of existing) {
    if (file.endsWith(".png") && retaking.has(file.slice(0, 2))) {
      await unlink(join(OUT_DIR, file));
    }
  }

  console.log(`base url: ${BASE_URL}`);
  console.log(`account:  ${account.email}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, locale: "zh-CN" });
  const page = await context.newPage();

  const failures = [];
  try {
    for (const step of steps) {
      console.log(`\n${step.id} — ${step.title}`);
      try {
        await step.run(page);
      } catch (error) {
        failures.push(`${step.id}: ${error.message.split("\n")[0]}`);
        console.error(`  FAILED: ${error.message.split("\n")[0]}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log("\npending (route not built yet):");
  for (const step of pending) console.log(`  ${step.id} — ${step.title} — 阻塞于 ${step.blockedOn}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} step(s) failed:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log("\nall implemented steps captured.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
