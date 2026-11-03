/**
 * Accessibility spot-checks for the public pages.
 *
 * Run against a local dev server or the deployment:
 *
 *   BASE_URL=https://restinprompts.vercel.app npm run verify:a11y
 *
 * This is not a full audit — it checks the handful of things that regressed or
 * were easy to get wrong here, and that can be measured rather than argued:
 *
 *  - **Target size (WCAG 2.2 §2.5.8, AA)**: interactive elements must be at
 *    least 24×24 CSS px. The pages are dense Chinese text at `text-xs`/`text-sm`,
 *    so links land under that by default. Links *inside a sentence* are exempt
 *    by the spec's inline exception and are skipped — padding those would break
 *    the line box, which is exactly why the exception exists.
 *  - **Accessible names** on every control, and a `<label>` for every field.
 *  - **Heading order**: no skipped level. The dashboard renders its «统计口径»
 *    h2 *after* the chart cards, so a chart titled h3 made the page read
 *    h1 → h3 and misstated the structure in a screen reader's heading list.
 *
 * Checked at a phone width as well as a desktop one, because the first two only
 * actually bite on a touch screen.
 */
import { chromium } from "playwright";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
// `/corrections` earns its place here rather than riding along with the other
// prose pages: it is the only public page with a multi-field form on it, so it
// is the one most likely to grow an input with no `<label>` or a submit button
// under the minimum. `/methodology` is pure text, and is listed because its
// cross-reference to `/corrections` and the new footer nav are links that have
// to clear the target size on a phone.
const PAGES = [
  "/",
  "/stats",
  "/pricing",
  "/company/chegg",
  "/methodology",
  "/corrections",
];
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
];
const MIN_TARGET_PX = 24;

const browser = await chromium.launch();
let failures = 0;

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  console.log(`\n### ${vp.name} (${vp.width}px)`);

  for (const path of PAGES) {
    const response = await page.goto(BASE + path, { waitUntil: "networkidle" });
    if (!response || response.status() !== 200) {
      console.log(`  ${path} — FAIL: status ${response?.status() ?? "no response"}`);
      failures++;
      continue;
    }

    const found = await page.evaluate((min) => {
      const result = { small: [], unnamed: [], unlabelled: [], jumps: [] };
      const interactive = "a[href], button, input:not([type=hidden]), select, textarea, [role=button]";

      for (const el of document.querySelectorAll(interactive)) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;

        const text = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ");
        // The spec's inline exception: a link whose parent is a run of text.
        const parentText = (el.parentElement?.textContent ?? "").trim().replace(/\s+/g, " ");
        const inline = el.tagName === "A" && parentText.length > text.length + 4;

        if (!inline && (box.height < min || box.width < min)) {
          result.small.push(`${el.tagName.toLowerCase()} ${Math.round(box.width)}x${Math.round(box.height)} "${text.slice(0, 28)}"`);
        }
        // `textContent` is the wrong source for a form control — for a
        // `<textarea>` it is the *value*, so an empty one with a perfectly good
        // `<label for>` used to be reported as nameless while its neighbour
        // passed purely because it happened to carry a placeholder. Check the
        // things that actually name a control, in roughly the order the
        // accessible-name computation does.
        const labelledBy = el.getAttribute("aria-labelledby");
        const named =
          text ||
          el.getAttribute("title") ||
          el.getAttribute("placeholder") ||
          (labelledBy &&
            labelledBy
              .split(/\s+/)
              .some((id) => document.getElementById(id)?.textContent?.trim())) ||
          (el.id &&
            document
              .querySelector(`label[for="${CSS.escape(el.id)}"]`)
              ?.textContent?.trim()) ||
          el.closest("label")?.textContent?.trim();
        if (!named) {
          result.unnamed.push(el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""));
        }
      }

      for (const field of document.querySelectorAll("input:not([type=hidden]),select,textarea")) {
        const labelled =
          (field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`)) ||
          field.closest("label") ||
          field.getAttribute("aria-label") ||
          field.getAttribute("aria-labelledby");
        if (!labelled) result.unlabelled.push(field.tagName.toLowerCase() + (field.id ? "#" + field.id : ""));
      }

      let previous = 0;
      for (const heading of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
        const level = Number(heading.tagName[1]);
        if (previous && level > previous + 1) {
          result.jumps.push(`h${previous}→h${level} at "${(heading.textContent ?? "").trim().slice(0, 24)}"`);
        }
        previous = level;
      }
      return result;
    }, MIN_TARGET_PX);

    const problems = [
      ...found.small.map((s) => `target <${MIN_TARGET_PX}px: ${s}`),
      ...found.unnamed.map((s) => `no accessible name: ${s}`),
      ...found.unlabelled.map((s) => `field without label: ${s}`),
      ...found.jumps.map((s) => `heading jump: ${s}`),
    ];
    const unique = [...new Set(problems)];

    if (unique.length === 0) {
      console.log(`  ${path} — ok`);
    } else {
      failures += unique.length;
      console.log(`  ${path} — ${unique.length} problem(s)`);
      for (const problem of unique) console.log(`      ${problem}`);
    }
  }
  await context.close();
}

await browser.close();
console.log(failures === 0 ? "\n全部通过。" : `\n共 ${failures} 项未通过。`);
process.exit(failures === 0 ? 0 : 1);
