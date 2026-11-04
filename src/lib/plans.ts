/**
 * Subscription tiers (ZCZ-7 §0, the 2026-11-03 re-cut that supersedes the
 * PRD's older "free = browsing" split).
 *
 * Deliberately *not* in `src/lib/enums.ts`: that file is the ZCZ-2 data
 * dictionary, which is about the records themselves. A plan is commercial
 * packaging, it carries no editorial meaning, and conflating the two would
 * invite someone to gate a field on a tier.
 *
 * The one rule that matters more than the table below:
 *
 *   **Reading is never a paid feature, and never an account feature.** An
 *   anonymous request sees the listing, every filter, every detail page with
 *   *all* of its sources and quotes, and the dashboard. There is no teaser
 *   truncation, no blur, no login modal. A plan only ever adds bulk and
 *   programmatic access to data the visitor could already have read by hand.
 *
 * So `ENTITLEMENTS` lists what a tier *adds*; there is no "can read" key,
 * because the question never gets asked.
 */

type NonEmpty<T> = readonly [T, ...T[]];

export const PLAN = {
  free: {
    zh: "免费",
    en: "Free",
    /**
     * A display string, not a money amount. It is *not* localised by language
     * — the price is USD for everyone — so do not reintroduce a `Zh`/`En`
     * split here, and do not parse it: the amount actually charged comes from
     * the Stripe price behind `STRIPE_PRICE_ID_PRO`, and this label only has
     * to agree with it. Billing runs in test mode, so nothing is captured.
     */
    priceLabel: "US$0",
    taglineZh: "注册只是为了成为付费主体，它不解锁任何阅读权限。",
  },
  pro: {
    zh: "专业版",
    en: "Pro",
    priceLabel: "US$9.90 / 月",
    taglineZh: "批量获取影响事件数据，或接进自己的系统。",
  },
} as const;

export type Plan = keyof typeof PLAN;
export const PLAN_VALUES = Object.keys(PLAN) as unknown as NonEmpty<Plan>;

export const DEFAULT_PLAN: Plan = "free";

/**
 * How an account reached its current plan. Recorded because "pro" acquired
 * through the local simulation switch and "pro" acquired through a Stripe
 * *test* checkout are both not real revenue, and the account page says so
 * rather than letting a demo be mistaken for a sale.
 */
export const PLAN_SOURCE = {
  stripe_test: { zh: "Stripe 测试模式结账", en: "Stripe test-mode checkout" },
  simulated: { zh: "本地模拟升级", en: "Local simulated upgrade" },
  manual: { zh: "人工设置", en: "Set manually" },
} as const;

export type PlanSource = keyof typeof PLAN_SOURCE;
export const PLAN_SOURCE_VALUES = Object.keys(PLAN_SOURCE) as unknown as NonEmpty<PlanSource>;

export function labelOfPlanSource(source: string, locale: "zh" | "en" = "zh"): string {
  return (PLAN_SOURCE as Record<string, { zh: string; en: string }>)[source]?.[locale] ?? source;
}

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

/**
 * What each tier adds on top of what everyone — including visitors with no
 * account at all — can already do.
 */
export const ENTITLEMENTS = {
  free: {
    exportFullCsv: false,
    apiKeys: false,
  },
  pro: {
    exportFullCsv: true,
    apiKeys: true,
  },
} as const satisfies Record<Plan, { exportFullCsv: boolean; apiKeys: boolean }>;

export type Entitlement = keyof (typeof ENTITLEMENTS)["free"];

export function can(plan: Plan, entitlement: Entitlement): boolean {
  return ENTITLEMENTS[plan][entitlement];
}

/**
 * The tier comparison rendered on the pricing page, as data rather than as
 * markup, so the page cannot drift from `ENTITLEMENTS` above.
 *
 * `anonymous` is a column on purpose. A pricing table that starts at "free
 * account" reads as though an account were the price of admission, which is
 * exactly the impression ZCZ-7 §0 forbids.
 */
export type TierColumn = "anonymous" | "subscriber" | "free" | "pro";

export const TIER_COLUMNS: { key: TierColumn; zh: string; noteZh: string }[] = [
  { key: "anonymous", zh: "匿名访客", noteZh: "不需要账号" },
  { key: "subscriber", zh: "邮件订阅者", noteZh: "只留邮箱，无需密码" },
  { key: "free", zh: "账号 · 免费", noteZh: "注册即可" },
  { key: "pro", zh: "账号 · 专业版", noteZh: "订阅后解锁" },
];

/** `true` = included, `false` = not included, string = a qualified answer. */
export const TIER_MATRIX: {
  featureZh: string;
  detailZh?: string;
  values: Record<TierColumn, boolean | string>;
}[] = [
  {
    featureZh: "浏览榜单、搜索与全部筛选",
    values: { anonymous: true, subscriber: true, free: true, pro: true },
  },
  {
    featureZh: "详情页的全部来源链接与原文引述",
    detailZh: "不做试读截断，不做模糊遮挡。",
    values: { anonymous: true, subscriber: true, free: true, pro: true },
  },
  {
    featureZh: "统计仪表盘",
    values: { anonymous: true, subscriber: true, free: true, pro: true },
  },
  {
    featureZh: "新增记录的邮件通知",
    detailZh: "只需要一个邮箱，不需要注册账号。",
    values: { anonymous: false, subscriber: true, free: "留邮箱即可", pro: "留邮箱即可" },
  },
  {
    featureZh: "全量 CSV 导出",
    detailZh: "仅影响事件档案，一行一条来源；不含首页停运名单。",
    values: { anonymous: false, subscriber: false, free: false, pro: true },
  },
  {
    featureZh: "API key 与只读查询接口",
    detailZh: "只读影响事件档案；不含首页停运名单。密钥可生成、可吊销。",
    values: { anonymous: false, subscriber: false, free: false, pro: true },
  },
];
