import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    await page.goto(base, { waitUntil: "networkidle" });
    assert.equal(await page.locator("table thead th").count(), 6);
    assert.ok(await page.locator("tr[data-shutdown-id]").count() > 0, "shutdown dataset required");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no page-level horizontal overflow");
    const region = page.getByRole("region", { name: "已停止运营公司表，可横向滚动" });
    if (width === 390) {
      await region.focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(150);
      assert.ok(await region.evaluate((el) => el.scrollLeft > 0), "table supports keyboard scrolling");
      await region.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      const source = page.locator(".archive-source-link").first();
      const box = await source.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, "source link is reachable after scrolling");
      await source.click();
      await page.waitForURL(/\/shutdown\/.*#sources/);
      const anchor = new URL(page.url()).hash;
      assert.equal(await page.locator(anchor).count(), 1, "source anchor resolves");
      await page.goto(base, { waitUntil: "networkidle" });
    }
    if (process.env.CAPTURE_DIR) {
      await mkdir(process.env.CAPTURE_DIR, { recursive: true });
      await page.screenshot({ path: `${process.env.CAPTURE_DIR}/table-${width}.png`, fullPage: true });
    }
    await page.getByLabel("搜索公司", { exact: true }).fill("Kite");
    await page.getByLabel("排序", { exact: true }).selectOption("name_asc");
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get("q") === "Kite");
    assert.equal(new URL(page.url()).searchParams.get("sort"), "name_asc");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.getByLabel("搜索公司", { exact: true }).inputValue(), "Kite");
    assert.equal(await page.getByLabel("排序", { exact: true }).inputValue(), "name_asc");
    const slugs = await page.locator("tr[data-shutdown-id]").evaluateAll((rows) => rows.map((row) => row.dataset.shutdownId));
    assert.ok(slugs.length > 0 && slugs.every((slug) => slug === "kite"));
    await page.getByLabel("搜索公司", { exact: true }).fill("no-such-company-ui-check");
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get("q") === "no-such-company-ui-check");
    assert.equal(await page.locator("tr[data-shutdown-id]").count(), 0);
    assert.ok(await page.getByText("没有符合这些筛选条件的记录。", { exact: true }).isVisible());
    console.log(`PASS table UI ${width}px: layout, source access, URL filters, sort, refresh, empty state`);
    await page.close();
  }
} finally {
  await browser.close();
}
