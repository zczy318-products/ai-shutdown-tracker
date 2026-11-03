#!/usr/bin/env node
/**
 * Captures the acceptance walkthrough screenshots into docs/acceptance/.
 *
 *   npm run capture:acceptance                      # against http://localhost:3000
 *   BASE_URL=https://restinprompts.vercel.app npm run capture:acceptance
 *
 * Start the target server first (`npm run dev`, or point BASE_URL at the
 * deployment). Re-runnable: the account scenario registers a fresh timestamped
 * account each run, so it never collides with rows left by a previous run.
 *
 * Two scenarios, in the order the product owner asked the demo to be shown
 * (plan revision 5, 访问模型): browsing requires no account, so the walkthrough
 * starts anonymously and only then shows what an account adds.
 *
 *   1. anonymous — a browser context that is never given a cookie. Every step
 *      asserts the context still has zero cookies, which is the actual claim
 *      being demonstrated: 榜单 / 筛选 / 详情 / 仪表盘 need no login.
 *   2. account   — register → login → upgrade (Stripe test mode) → CSV export.
 *
 * A step whose route does not exist yet is reported as pending rather than
 * failing, so this script and docs/ACCEPTANCE.md cannot drift apart: every run
 * prints what is still missing and what it is waiting on.
 *
 * Browser setup: `npx playwright install --with-deps chromium`. In a sandbox
 * without root, see docs/ACCEPTANCE.md §1 for the rootless equivalent (the
 * shared libraries and the CJK font both have to be provided, or Chinese text
 * renders as tofu boxes).
 */
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
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

/** Raised by a step when the thing it shoots is not built yet. */
class Pending extends Error {}

function pending(message) {
  throw new Pending(message);
}

/** Names shot by *this* run, used to sweep stale images at the end. */
const captured = new Set();

async function shoot(page, name) {
  // Guard against shooting mid-navigation. If a step triggered a navigation
  // that has not committed yet, the outgoing document can already be gone
  // while the incoming one has no <head>, and addStyleTag then throws on a
  // null appendChild target — which is exactly how 02 failed once.
  await page.waitForLoadState("domcontentloaded");
  // The Next.js dev-tools badge floats over every page in `npm run dev` and is
  // pure noise in an acceptance screenshot. No-op against a production build.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: true });
  captured.add(`${name}.png`);
  console.log(`  captured docs/acceptance/${name}.png`);
}

/**
 * Removes superseded images of the steps this run actually re-shot, so an old
 * screenshot of a since-changed page can never be presented as current
 * evidence.
 *
 * Scoped by step number on purpose: a step that was *pending* this run (route
 * not built yet, or the server was down) keeps whatever it already had. An
 * earlier version of this swept everything the run did not capture, which
 * deleted the register/login shots the moment a run failed to reach them.
 */
async function sweepStale() {
  const reshot = new Set([...captured].map((file) => file.slice(0, 2)));
  for (const file of await readdir(OUT_DIR).catch(() => [])) {
    if (file.endsWith(".png") && reshot.has(file.slice(0, 2)) && !captured.has(file)) {
      await unlink(join(OUT_DIR, file));
      console.log(`  removed superseded docs/acceptance/${file}`);
    }
  }
}

/** Text Chromium/Next put on the page when the render never arrived. */
const BROKEN_PAGE_MARKERS = ["This page couldn’t load", "This page couldn't load", "Application error"];

/** Navigates and reports a missing route as pending instead of shooting a 404. */
async function visit(page, path, { expect } = {}) {
  const response = await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  const status = response?.status() ?? 0;
  if (status === 404) pending(`${path} 返回 404，路由还没上线`);
  if (status >= 500) throw new Error(`${path} 返回 ${status}`);

  // A 200 is not enough. If the server dies mid-stream the navigation still
  // resolves and what is on screen is the browser's error page — which is how
  // an earlier run produced a perfectly valid-looking screenshot of nothing.
  const body = await page.locator("body").innerText();
  if (BROKEN_PAGE_MARKERS.some((marker) => body.includes(marker))) {
    throw new Error(`${path} 返回了 ${status}，但页面没渲染出来（浏览器错误页），服务端可能中途挂了`);
  }

  if (expect && (await page.locator(expect).count()) === 0) {
    pending(`${path} 打开了，但找不到 ${expect}，页面还没有这部分`);
  }
  return status;
}

/**
 * The anonymous claim is only demonstrated if the browser really has no
 * session. Checked before every shot rather than once at the start, so a page
 * that sets a session cookie behind our back cannot slip through.
 */
async function assertAnonymous(page) {
  const cookies = await page.context().cookies();
  if (cookies.length > 0) {
    throw new Error(`匿名场景出现了 cookie：${cookies.map((c) => c.name).join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Anonymous — no account, no cookie
// ---------------------------------------------------------------------------

const anonymousSteps = [
  {
    id: "01-list",
    title: "匿名浏览榜单（首页，无 cookie）",
    blockedOn: "T5 榜单页",
    async run(page) {
      await visit(page, "/", { expect: 'a[href^="/company/"]' });
      await assertAnonymous(page);
      await shoot(page, "01-list");
    },
  },
  {
    id: "02-filter",
    title: "匿名筛选（置信度 = 高）",
    blockedOn: "T5 筛选表单",
    async run(page) {
      await visit(page, "/", { expect: "#f-confidence" });
      await page.selectOption("#f-confidence", "high");
      await page
        .locator("form")
        .filter({ has: page.locator("#f-confidence") })
        .locator('button[type="submit"]')
        .click();
      // Wait for the *filtered* URL, not just for the network to fall idle.
      // Racing `waitForLoadState` against the click resolves against the page
      // we are leaving — it is already idle — so the shot could land before
      // the new document existed.
      await page.waitForURL(/[?&]confidence=high\b/);
      await page.waitForLoadState("networkidle");
      await assertAnonymous(page);
      await shoot(page, "02-filter");
    },
  },
  {
    id: "03-detail",
    title: "匿名看公司详情（来源 URL + 原文引述）",
    blockedOn: "T5 详情页",
    async run(page) {
      await visit(page, "/", { expect: 'a[href^="/company/"]' });
      const href = await page.locator('a[href^="/company/"]').first().getAttribute("href");
      await visit(page, href);
      // The point of this shot: the record's evidence is on the page. A detail
      // page without an outbound source link would not evidence anything.
      if ((await page.locator('a[href^="http"]').count()) === 0) {
        pending(`${href} 上没有任何外链来源，详情页还没有来源区块`);
      }
      await assertAnonymous(page);
      await shoot(page, "03-detail");
    },
  },
  {
    id: "04-dashboard",
    title: "匿名看统计仪表盘",
    blockedOn: "T5 仪表盘",
    async run(page) {
      // The route is not merged yet; try the candidates in order rather than
      // hard-coding one that may not be the one T5 ships. `置信度` is required
      // rather than just a 200, because the dashboard's whole point is the
      // confidence breakdown — a page without it is not this step.
      for (const path of ["/stats", "/dashboard", "/trends"]) {
        try {
          await visit(page, path, { expect: "text=置信度" });
        } catch (error) {
          if (error instanceof Pending) continue;
          throw error;
        }
        await assertAnonymous(page);
        await shoot(page, "04-dashboard");
        return;
      }
      pending("/stats、/dashboard、/trends 都没有带置信度分布的页面，仪表盘还没上线");
    },
  },
];

// ---------------------------------------------------------------------------
// 2. Account — what registering actually adds
// ---------------------------------------------------------------------------

const accountSteps = [
  {
    id: "05-register",
    title: "注册",
    blockedOn: "—",
    async run(page) {
      await visit(page, "/register", { expect: "#email" });
      await page.fill("#email", account.email);
      await page.fill("#password", account.password);
      // Shoot the filled form *before* submitting: the point of this shot is
      // that a human can see what was entered.
      await shoot(page, "05-register");
      await Promise.all([
        page.waitForURL((url) => !url.pathname.startsWith("/register"), { timeout: 30_000 }),
        page.click('button[type="submit"]'),
      ]);
      await page.waitForLoadState("networkidle");
      await shoot(page, "05b-register-success");
    },
  },
  {
    id: "06-login",
    title: "登录",
    blockedOn: "—",
    async run(page) {
      // Drop the session the registration just created, so this really exercises
      // the login path rather than redirecting an already-authenticated user.
      await page.context().clearCookies();
      await visit(page, "/login", { expect: "#email" });
      await page.fill("#email", account.email);
      await page.fill("#password", account.password);
      await shoot(page, "06-login");
      await Promise.all([
        page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 }),
        page.click('button[type="submit"]'),
      ]);
      await page.waitForLoadState("networkidle");
      await shoot(page, "06b-signed-in");
    },
  },
  {
    id: "07-upgrade",
    title: "升级到付费（Stripe 测试模式）",
    blockedOn: "T6 SaaS 层",
    async run(page) {
      await visit(page, "/pricing", { expect: "text=专业版" });
      await shoot(page, "07-upgrade");

      // Two billing modes, two different buttons (src/app/pricing/page.tsx):
      // with STRIPE_SECRET_KEY it goes to Stripe's hosted test checkout, and
      // without one T6 flips the plan locally and labels it a simulation.
      // Either is a valid demo; the shot afterwards shows which one happened.
      const button = page
        .locator("button")
        .filter({ hasText: /模拟升级|Stripe 测试模式结账|升级/ })
        .first();
      if ((await button.count()) === 0) pending("/pricing 上没有可点的升级按钮");

      await button.click();
      await page.waitForLoadState("networkidle");
      // The simulated path stays on /pricing and re-renders; the Stripe path
      // navigates to checkout.stripe.com. Give the re-render a beat either way.
      await page.waitForTimeout(1500);
      await shoot(page, "07b-upgraded");
    },
  },
  {
    id: "08-export",
    title: "导出 CSV",
    blockedOn: "T6 CSV 导出",
    async run(page) {
      await visit(page, "/account", { expect: "text=CSV" });
      await shoot(page, "08-export");

      // A download is not a screenshot, so evidence it by what came back —
      // and keep the first lines next to the screenshots, since "导出能用" is
      // a claim about the file's contents, not about a button existing.
      const response = await page.request.get(`${BASE_URL}/api/export/records`);
      if (response.status() === 404) pending("/api/export/records 还不存在");
      if (response.status() === 402) {
        pending("导出返回 402：当前账号还是免费档，付费墙生效但没拿到 CSV（升级这一步没成功）");
      }
      if (!response.ok()) throw new Error(`/api/export/records 返回 ${response.status()}`);

      const lines = (await response.text()).split("\n");
      const head = lines.slice(0, 4).join("\n");
      await writeFile(join(OUT_DIR, "08-export-head.csv"), `${head}\n`, "utf8");
      console.log(`  CSV 共 ${lines.length - 1} 行（含表头），前 4 行已存 docs/acceptance/08-export-head.csv`);
      console.log(head.replace(/^/gm, "    "));
    },
  },
];

const scenarios = [
  { name: "匿名（无账号、无 cookie）", steps: anonymousSteps, anonymous: true },
  { name: "账号（注册后才有的能力）", steps: accountSteps, anonymous: false },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`base url: ${BASE_URL}`);
  console.log(`account:  ${account.email}`);

  const browser = await chromium.launch();
  const failures = [];
  const skipped = [];

  try {
    for (const scenario of scenarios) {
      console.log(`\n=== 场景：${scenario.name}`);
      // A fresh context per scenario. The anonymous one is never handed a
      // cookie, which is what makes its screenshots mean anything.
      const context = await browser.newContext({ viewport: VIEWPORT, locale: "zh-CN" });
      const page = await context.newPage();
      try {
        for (const step of scenario.steps) {
          console.log(`\n${step.id} — ${step.title}`);
          try {
            await step.run(page);
          } catch (error) {
            const reason = error.message.split("\n")[0];
            if (error instanceof Pending) {
              skipped.push(`${step.id} — ${step.title} — ${reason}（阻塞于 ${step.blockedOn}）`);
              console.log(`  待补：${reason}`);
            } else {
              failures.push(`${step.id}: ${reason}`);
              console.error(`  FAILED: ${reason}`);
            }
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  await sweepStale();

  if (skipped.length > 0) {
    console.log("\n还缺的截图（路由未上线）：");
    for (const line of skipped) console.log(`  ${line}`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} step(s) failed:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`\n已实现的步骤全部截图完成${skipped.length > 0 ? `，${skipped.length} 步待补` : ""}。`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
