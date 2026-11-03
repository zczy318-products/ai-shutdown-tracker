/**
 * Palette guard: the places where the design rules say «no hue».
 *
 *   npm run verify:palette
 *
 * Two rules are being protected here, and neither of them is a matter of taste:
 *
 *  - **Attribution confidence is an achromatic ordinal scale** (design spec
 *    §3.1). The three steps must be told apart by lightness, not by colour,
 *    because the grade is a degree of certainty and colouring it would read as
 *    good/bad. The check is that contrast against the page background *grows*
 *    with the grade — which is the invariant that survives both themes, where
 *    plain "high is darkest" does not: in `.dark`, high is the *lightest* step.
 *  - **The billing-cycle chooser carries no hue** (ZCZ-14). The annual option
 *    earns its emphasis with border weight and a neutral tint, not with a
 *    semantic green — `/pricing` does not render outcome or confidence, but the
 *    tokens are shared site-wide, so a green introduced here leaks out through
 *    them.
 *
 * Why this reads the tokens instead of screenshotting the page: the rendered
 * check belongs in `verify:a11y` (Playwright), and that one needs a browser.
 * This one is arithmetic on `globals.css` plus a read of the component source,
 * so it runs anywhere — including environments without Chromium's system
 * libraries — and it fails on the *cause* (a hue in a token or a class name)
 * rather than on a pixel downstream of it.
 *
 * Measuring the rendered pixels is still the honest cross-check. `oklch()` is
 * what `getComputedStyle()` resolves to `lab(...)` in this project, so a naive
 * regex over that string will misread a neutral grey as saturated; paint the
 * colour onto a 1×1 canvas and read `getImageData` back instead.
 */
import { readFile } from "node:fs/promises";

const CSS_FILE = "src/app/globals.css";
const PRICING_FILE = "src/app/pricing/page.tsx";

/**
 * `--background` is deliberately a hair off neutral (a warm stone grey, design
 * spec §2.2). Every other neutral token is an exact zero, so the tolerance
 * exists for that one token and is far too tight to admit a real colour.
 */
const NEUTRAL_CHROMA_TOLERANCE = 0.002;

/** Tokens that must stay neutral because the whole site is painted with them. */
const NEUTRAL_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "border",
  "input",
  "ring",
];

/** The four the billing-cycle chooser actually paints with: exact zeroes. */
const CHOOSER_TOKENS = ["foreground", "border", "muted", "muted-foreground"];

/** The confidence ramp is allowed a trace of warmth, nothing more. */
const CONFIDENCE_CHROMA_CEILING = 0.02;

/**
 * Hue-bearing utilities. The Tailwind families are listed by name rather than
 * by pattern so that a neutral `bg-muted` is not caught, and the in-house
 * chromatic tokens are listed alongside them — `destructive` and `chart-1…4`
 * are the project's own colours and are just as out of place in this control.
 */
const HUE_FAMILIES = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink",
  "rose", "destructive", "chart-1", "chart-2", "chart-3", "chart-4",
];
const UTILITY_PREFIXES =
  "bg|text|border|ring|outline|from|via|to|decoration|shadow|fill|stroke|divide|accent|caret";

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/** The declarations inside one selector block, up to its closing brace. */
function block(css, selector) {
  const start = css.indexOf(selector + " {");
  if (start === -1) throw new Error(`${CSS_FILE} 里找不到 ${selector} 块`);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

/** `--name: oklch(L C H[ / A])` → `{ l, c, h }`, keyed by name. */
function tokensOf(blockSource) {
  const tokens = new Map();
  const pattern = /--([a-z0-9-]+):\s*oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/g;
  for (const [, name, l, c, h] of blockSource.matchAll(pattern)) {
    tokens.set(name, { l: Number(l), c: Number(c), h: Number(h) });
  }
  return tokens;
}

const css = await readFile(CSS_FILE, "utf8");
const themes = [
  { name: "light", tokens: tokensOf(block(css, ":root")) },
  { name: "dark", tokens: tokensOf(block(css, ".dark")) },
];

console.log("-- 1. 中性 token 不带色相 --");
for (const theme of themes) {
  // A missing token would otherwise make every assertion below vacuously true.
  const missing = NEUTRAL_TOKENS.filter((name) => !theme.tokens.has(name));
  check(
    missing.length === 0,
    `${theme.name}: ${NEUTRAL_TOKENS.length} 个中性 token 都解析到了`,
    missing.length ? `缺 ${missing.join(", ")}` : `共 ${theme.tokens.size} 个 oklch token`,
  );

  const tinted = NEUTRAL_TOKENS.filter(
    (name) => (theme.tokens.get(name)?.c ?? 0) > NEUTRAL_CHROMA_TOLERANCE,
  ).map((name) => `--${name} c=${theme.tokens.get(name).c}`);
  check(
    tinted.length === 0,
    `${theme.name}: 中性 token 的彩度都 ≤ ${NEUTRAL_CHROMA_TOLERANCE}`,
    tinted.length ? tinted.join(" / ") : "最大彩度 " +
      Math.max(...NEUTRAL_TOKENS.map((name) => theme.tokens.get(name)?.c ?? 0)),
  );

  const notZero = CHOOSER_TOKENS.filter((name) => theme.tokens.get(name)?.c !== 0);
  check(
    notZero.length === 0,
    `${theme.name}: 周期切换控件用的 ${CHOOSER_TOKENS.length} 个 token 彩度正好是 0`,
    notZero.length ? notZero.map((n) => `--${n} c=${theme.tokens.get(n).c}`).join(" / ") : CHOOSER_TOKENS.map((n) => `--${n}`).join(" "),
  );
}

console.log("\n-- 2. 归因置信度：靠明度分档，不靠颜色 --");
for (const theme of themes) {
  const ramp = ["low", "medium", "high"].map((step) => ({
    step,
    ...(theme.tokens.get(`conf-${step}`) ?? {}),
  }));
  const parsed = ramp.every((entry) => typeof entry.l === "number");
  check(parsed, `${theme.name}: 三档 --conf-* 都解析到了`, ramp.map((e) => `${e.step}=${e.l ?? "?"}`).join(" "));
  if (!parsed) continue;

  const tinted = ramp.filter((entry) => entry.c > CONFIDENCE_CHROMA_CEILING);
  check(
    tinted.length === 0,
    `${theme.name}: 三档彩度都 ≤ ${CONFIDENCE_CHROMA_CEILING}`,
    tinted.length
      ? tinted.map((e) => `${e.step} c=${e.c}`).join(" / ")
      : ramp.map((e) => `${e.step} c=${e.c}`).join(" "),
  );

  // Contrast against the page background, not raw lightness: that is the form
  // of the rule that holds in both themes.
  const backgroundL = theme.tokens.get("background").l;
  const distance = ramp.map((entry) => ({ step: entry.step, d: Math.abs(entry.l - backgroundL) }));
  const rising = distance[0].d < distance[1].d && distance[1].d < distance[2].d;
  check(
    rising,
    `${theme.name}: 与底色的明度差随档位严格递增（low < medium < high）`,
    distance.map((e) => `${e.step}=${e.d.toFixed(3)}`).join(" "),
  );
}

console.log("\n-- 3. 周期切换控件不引入色相 --");
const pricing = await readFile(PRICING_FILE, "utf8");
const chooserStart = pricing.indexOf("function IntervalChoice(");
check(chooserStart !== -1, `${PRICING_FILE} 里找到了 IntervalChoice`);
if (chooserStart !== -1) {
  // `\n}\n`, not `\n}`: the component's destructured signature contains a
  // `}: {` at the start of a line, and stopping there would cut the body off
  // before any class name. The control assertion below is what caught that.
  const chooserEnd = pricing.indexOf("\n}\n", chooserStart);
  const chooser = pricing.slice(chooserStart, chooserEnd);

  // Control: if the extraction ever stops capturing the class names, the hue
  // scan below would pass on an empty string and prove nothing.
  const utilities = [...chooser.matchAll(new RegExp(`\\b(?:${UTILITY_PREFIXES})-[a-z0-9/-]+`, "g"))].map(
    (match) => match[0],
  );
  check(
    utilities.length >= 4,
    "对照：确实抓到了控件的工具类，不是在扫空字符串",
    `${utilities.length} 个：${[...new Set(utilities)].join(" ")}`,
  );

  const hues = utilities.filter((utility) =>
    HUE_FAMILIES.some((family) => new RegExp(`-${family}(?:-\\d{2,3})?(?:/|$)`).test(utility)),
  );
  check(
    hues.length === 0,
    `控件里没有带色相的工具类（查了 ${HUE_FAMILIES.length} 个色系）`,
    hues.length ? hues.join(" ") : "无",
  );

  // The emphasis has to come from somewhere; these are the allowed carriers.
  const weight = ["border-foreground", "font-medium", "bg-foreground/5"].filter((cue) =>
    chooser.includes(cue),
  );
  check(
    weight.length >= 2,
    "选中态的视觉重量来自明度/字重/边框",
    weight.join(" "),
  );
}

console.log(failures === 0 ? "\n全部通过。" : `\n共 ${failures} 项未通过。`);
process.exit(failures === 0 ? 0 : 1);
