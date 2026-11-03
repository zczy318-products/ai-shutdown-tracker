/**
 * Every enum in the domain model, transcribed from the ZCZ-2 data dictionary §1.
 *
 * This file is the single source of truth: `src/db/schema.ts` derives its
 * `pgEnum` value arrays from `Object.keys()` here, so a database value and a UI
 * label can never drift apart. Adding or removing a value is a migration —
 * ask Product PM on ZCZ-2 first, do not edit these keys to work around a gap.
 * Use the `other` / `unknown` fallbacks instead.
 *
 * Database values are English snake_case; Chinese text here is display-only and
 * never reaches the database (dictionary §0).
 */

/** `[first, ...rest]` is what `pgEnum` wants, and it keeps the arrays non-empty. */
type NonEmpty<T> = readonly [T, ...T[]];

export type EnumLabels<K extends string> = Record<K, { zh: string; en: string }>;

function keysOf<K extends string>(labels: EnumLabels<K>): NonEmpty<K> {
  return Object.keys(labels) as unknown as NonEmpty<K>;
}

// ---------------------------------------------------------------------------
// §1.1 industry (21)
// ---------------------------------------------------------------------------

export const INDUSTRY = {
  education: { zh: "教育 / 在线学习", en: "Education & E-learning" },
  media_publishing: { zh: "媒体 / 内容出版", en: "Media & Publishing" },
  software_saas: { zh: "软件 / SaaS", en: "Software & SaaS" },
  it_services: { zh: "IT 服务 / 外包", en: "IT Services & Outsourcing" },
  customer_service_bpo: { zh: "客服 / BPO", en: "Customer Service & BPO" },
  translation_localization: { zh: "翻译 / 本地化", en: "Translation & Localization" },
  design_creative: { zh: "设计 / 创意 / 插画", en: "Design & Creative" },
  data_annotation: { zh: "数据标注 / AI 训练数据", en: "Data Annotation & AI Training Data" },
  marketing_advertising: { zh: "市场 / 广告", en: "Marketing & Advertising" },
  ecommerce_retail: { zh: "电商 / 零售", en: "E-commerce & Retail" },
  finance_insurance: { zh: "金融 / 保险", en: "Finance & Insurance" },
  healthcare: { zh: "医疗 / 健康", en: "Healthcare" },
  manufacturing: { zh: "制造业", en: "Manufacturing" },
  logistics_transport: { zh: "物流 / 交通", en: "Logistics & Transport" },
  telecom: { zh: "电信", en: "Telecommunications" },
  legal: { zh: "法律服务", en: "Legal Services" },
  recruitment_hr: { zh: "招聘 / 人力资源", en: "Recruitment & HR" },
  gaming_entertainment: { zh: "游戏 / 娱乐", en: "Gaming & Entertainment" },
  travel_hospitality: { zh: "旅游 / 酒店", en: "Travel & Hospitality" },
  food_beverage: { zh: "食品 / 饮料", en: "Food & Beverage" },
  other: { zh: "其他", en: "Other" },
} as const satisfies EnumLabels<string>;
export type Industry = keyof typeof INDUSTRY;
export const INDUSTRY_VALUES = keysOf(INDUSTRY);

// ---------------------------------------------------------------------------
// §1.2 region (6) — dashboard grouping only, derived from country_code
// ---------------------------------------------------------------------------

export const REGION = {
  north_america: { zh: "北美", en: "North America" },
  latin_america: { zh: "拉美", en: "Latin America" },
  europe: { zh: "欧洲", en: "Europe" },
  middle_east_africa: { zh: "中东与非洲", en: "Middle East & Africa" },
  asia_pacific: { zh: "亚太", en: "Asia-Pacific" },
  global: { zh: "全球 / 跨区域", en: "Global / Multi-region" },
} as const satisfies EnumLabels<string>;
export type Region = keyof typeof REGION;
export const REGION_VALUES = keysOf(REGION);

// ---------------------------------------------------------------------------
// §1.3 company_size (6)
// ---------------------------------------------------------------------------

export const COMPANY_SIZE = {
  micro: { zh: "微型（1–10 人）", en: "Micro (1–10)" },
  small: { zh: "小型（11–50 人）", en: "Small (11–50)" },
  medium: { zh: "中型（51–250 人）", en: "Medium (51–250)" },
  large: { zh: "大型（251–5000 人）", en: "Large (251–5,000)" },
  enterprise: { zh: "超大型（5000 人以上）", en: "Enterprise (5,000+)" },
  unknown: { zh: "未知", en: "Unknown" },
} as const satisfies EnumLabels<string>;
export type CompanySize = keyof typeof COMPANY_SIZE;
export const COMPANY_SIZE_VALUES = keysOf(COMPANY_SIZE);

// ---------------------------------------------------------------------------
// §1.4 outcome (7)
// ---------------------------------------------------------------------------

export const OUTCOME = {
  shutdown: { zh: "停止运营 / 关闭", en: "Shut down" },
  bankruptcy: { zh: "破产 / 进入破产程序", en: "Bankruptcy" },
  mass_layoff: { zh: "大幅裁员", en: "Mass layoff" },
  downsizing_announced: { zh: "宣布缩编计划", en: "Downsizing announced" },
  pivot: { zh: "转型", en: "Pivot" },
  acquired: { zh: "被收购", en: "Acquired" },
  /** Dictionary §1.4: these cases must be recorded, or the dataset is biased. */
  reversed: { zh: "已撤回 / 回退", en: "Reversed" },
} as const satisfies EnumLabels<string>;
export type Outcome = keyof typeof OUTCOME;
export const OUTCOME_VALUES = keysOf(OUTCOME);

// ---------------------------------------------------------------------------
// §1.5 impact_type (4) — fixed by the ZCZ-1 product constraint, do not extend
// ---------------------------------------------------------------------------

export const IMPACT_TYPE = {
  replaced_by_ai_product: { zh: "被 AI 产品替代", en: "Replaced by an AI product" },
  ai_cost_cutting_layoff: { zh: "AI 降本裁员", en: "AI-driven cost-cutting layoff" },
  voluntary_pivot: { zh: "主动转型", en: "Voluntary pivot toward AI" },
  mentioned_in_coverage: { zh: "报道提及", en: "Mentioned in coverage" },
} as const satisfies EnumLabels<string>;
export type ImpactType = keyof typeof IMPACT_TYPE;
export const IMPACT_TYPE_VALUES = keysOf(IMPACT_TYPE);

// ---------------------------------------------------------------------------
// §1.6 attribution_confidence (3) — no database default, always chosen by hand
// ---------------------------------------------------------------------------

export const ATTRIBUTION_CONFIDENCE = {
  high: { zh: "高", en: "High" },
  medium: { zh: "中", en: "Medium" },
  low: { zh: "低", en: "Low" },
} as const satisfies EnumLabels<string>;
export type AttributionConfidence = keyof typeof ATTRIBUTION_CONFIDENCE;
export const ATTRIBUTION_CONFIDENCE_VALUES = keysOf(ATTRIBUTION_CONFIDENCE);

// ---------------------------------------------------------------------------
// §1.7 source_type (6)
// ---------------------------------------------------------------------------

export const SOURCE_TYPE = {
  primary_company: { zh: "公司一手材料", en: "Primary (company)" },
  tier1_media: { zh: "主流媒体原创报道", en: "Tier-1 media" },
  trade_media: { zh: "行业垂直媒体", en: "Trade media" },
  research: { zh: "研究机构 / 学术", en: "Research" },
  aggregator: { zh: "聚合 / 榜单 / 二手转载", en: "Aggregator" },
  other: { zh: "其他", en: "Other" },
} as const satisfies EnumLabels<string>;
export type SourceType = keyof typeof SOURCE_TYPE;
export const SOURCE_TYPE_VALUES = keysOf(SOURCE_TYPE);

/**
 * Dictionary §1.7 / §3: `attribution_confidence = 'high'` requires at least one
 * source of one of these types. Enforced in `assertPublishable`.
 */
export const FIRST_HAND_SOURCE_TYPES: readonly SourceType[] = ["primary_company", "tier1_media"];

// ---------------------------------------------------------------------------
// §1.8 record_status (5)
// ---------------------------------------------------------------------------

export const RECORD_STATUS = {
  draft: { zh: "草稿", en: "Draft" },
  in_review: { zh: "待审核", en: "In review" },
  published: { zh: "已发布", en: "Published" },
  rejected: { zh: "已拒收", en: "Rejected" },
  archived: { zh: "已下架", en: "Archived" },
} as const satisfies EnumLabels<string>;
export type RecordStatus = keyof typeof RECORD_STATUS;
export const RECORD_STATUS_VALUES = keysOf(RECORD_STATUS);

/**
 * The only status the public site may read. Dictionary §1.8 marks every other
 * value as not publicly visible, so public queries filter on exactly this.
 */
export const PUBLIC_RECORD_STATUS: RecordStatus = "published";

// ---------------------------------------------------------------------------
// §1.9 link_health (4)
// ---------------------------------------------------------------------------

export const LINK_HEALTH = {
  ok: { zh: "可达", en: "Reachable" },
  bot_blocked: { zh: "反爬拦截", en: "Bot-blocked" },
  unreachable: { zh: "不可达", en: "Unreachable" },
  dead: { zh: "失效", en: "Dead" },
} as const satisfies EnumLabels<string>;
export type LinkHealth = keyof typeof LINK_HEALTH;
export const LINK_HEALTH_VALUES = keysOf(LINK_HEALTH);

// ---------------------------------------------------------------------------
// §1.1 event_date_precision — stored as varchar(5), not a pgEnum (dictionary §3)
// ---------------------------------------------------------------------------

export const EVENT_DATE_PRECISION = {
  day: { zh: "精确到日", en: "Day" },
  month: { zh: "精确到月", en: "Month" },
  year: { zh: "精确到年", en: "Year" },
} as const satisfies EnumLabels<string>;
export type EventDatePrecision = keyof typeof EVENT_DATE_PRECISION;
export const EVENT_DATE_PRECISION_VALUES = keysOf(EVENT_DATE_PRECISION);

// ---------------------------------------------------------------------------
// §0 country_code — char(2), validated against this allowlist, never a pgEnum
// ---------------------------------------------------------------------------

/**
 * ISO 3166-1 alpha-2, grouped by the `region` the dictionary wants stored
 * alongside it. The allowlist is *derived* from this map rather than kept
 * separately, so a code can never be accepted without a region to file it
 * under. Grouping is a reporting convention, not geography: edit freely, it is
 * application-level data with no migration cost.
 */
const REGION_COUNTRIES: Record<Region, readonly string[]> = {
  north_america: ["BM", "CA", "GL", "PM", "US"],
  latin_america: [
    "AG", "AI", "AR", "AW", "BB", "BL", "BO", "BQ", "BR", "BS", "BZ", "CL", "CO", "CR", "CU",
    "CW", "DM", "DO", "EC", "FK", "GD", "GF", "GP", "GT", "GY", "HN", "HT", "JM", "KN", "KY",
    "LC", "MF", "MQ", "MS", "MX", "NI", "PA", "PE", "PR", "PY", "SR", "SV", "SX", "TC", "TT",
    "UY", "VC", "VE", "VG", "VI",
  ],
  europe: [
    "AD", "AL", "AT", "AX", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK", "EE", "ES",
    "FI", "FO", "FR", "GB", "GG", "GI", "GR", "HR", "HU", "IE", "IM", "IS", "IT", "JE", "LI",
    "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "RU",
    "SE", "SI", "SJ", "SK", "SM", "TR", "UA", "VA", "XK",
  ],
  middle_east_africa: [
    "AE", "AO", "BF", "BH", "BI", "BJ", "BW", "CD", "CF", "CG", "CI", "CM", "CV", "DJ", "DZ",
    "EG", "EH", "ER", "ET", "GA", "GH", "GM", "GN", "GQ", "GW", "IL", "IQ", "IR", "JO", "KE",
    "KM", "KW", "LB", "LR", "LS", "LY", "MA", "MG", "ML", "MR", "MU", "MW", "MZ", "NA", "NE",
    "NG", "OM", "PS", "QA", "RE", "RW", "SA", "SC", "SD", "SH", "SL", "SN", "SO", "SS", "ST",
    "SY", "SZ", "TD", "TG", "TN", "TZ", "UG", "YE", "YT", "ZA", "ZM", "ZW",
  ],
  asia_pacific: [
    "AF", "AM", "AS", "AU", "AZ", "BD", "BN", "BT", "CC", "CK", "CN", "CX", "FJ", "FM", "GE",
    "GU", "HK", "ID", "IN", "IO", "JP", "KG", "KH", "KI", "KP", "KR", "KZ", "LA", "LK", "MH",
    "MM", "MN", "MO", "MP", "MV", "MY", "NC", "NF", "NP", "NR", "NU", "NZ", "PF", "PG", "PH",
    "PK", "PW", "SB", "SG", "TH", "TJ", "TK", "TL", "TM", "TO", "TV", "TW", "UZ", "VN", "VU",
    "WF", "WS",
  ],
  /** `ZZ` is the dictionary's explicit code for multinational / unattributable. */
  global: ["AQ", "BV", "GS", "HM", "TF", "UM", "ZZ"],
};

export const COUNTRY_TO_REGION: Readonly<Record<string, Region>> = Object.freeze(
  Object.fromEntries(
    (Object.entries(REGION_COUNTRIES) as [Region, readonly string[]][]).flatMap(
      ([region, codes]) => codes.map((code) => [code, region] as const),
    ),
  ),
);

export const COUNTRY_CODES: readonly string[] = Object.freeze(
  Object.keys(COUNTRY_TO_REGION).sort(),
);

/** The dictionary's fallback: unattributable / multinational. */
export const MULTINATIONAL_COUNTRY_CODE = "ZZ";

export function isCountryCode(code: string): boolean {
  return Object.hasOwn(COUNTRY_TO_REGION, code);
}

/**
 * Dictionary §1.2: `region` is derived from `country_code` but still stored, so
 * dashboard aggregation never has to recompute it. This is the one derivation
 * point — admin forms call it instead of letting an editor pick a region that
 * contradicts the country.
 */
export function regionForCountry(code: string): Region {
  return COUNTRY_TO_REGION[code] ?? "global";
}

/**
 * Country display names come from ICU rather than a hand-maintained table of
 * ~250 translations. Node ships full-icu since v13, and every browser we target
 * has `Intl.DisplayNames`; the code itself is the fallback.
 */
export function countryLabel(code: string, locale: "zh" | "en" = "zh"): string {
  if (code === MULTINATIONAL_COUNTRY_CODE) {
    return locale === "zh" ? "跨国 / 无法归属" : "Multinational / unattributed";
  }
  try {
    const names = new Intl.DisplayNames([locale === "zh" ? "zh-Hans" : "en"], {
      type: "region",
    });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

// ---------------------------------------------------------------------------
// subscriber_status (T10 / ZCZ-11) — NOT from the data dictionary
// ---------------------------------------------------------------------------

/**
 * The email-subscription lifecycle. Lives here only because `src/db/schema.ts`
 * builds every `pgEnum` from this file; it is not part of the ZCZ-2 dictionary
 * and changing it needs no sign-off from Product PM.
 *
 * `pending` is the state a double opt-in signup lands in: a row exists, but the
 * address has not proved it wants mail yet. Only `confirmed` is mailable, and
 * `unsubscribed` is terminal until the person subscribes again.
 */
export const SUBSCRIBER_STATUS = {
  pending: { zh: "待确认", en: "Pending confirmation" },
  confirmed: { zh: "已确认", en: "Confirmed" },
  unsubscribed: { zh: "已退订", en: "Unsubscribed" },
} as const satisfies EnumLabels<string>;
export type SubscriberStatus = keyof typeof SUBSCRIBER_STATUS;
export const SUBSCRIBER_STATUS_VALUES = keysOf(SUBSCRIBER_STATUS);

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Chinese label for a value, falling back to the raw database value. */
export function labelOf<K extends string>(
  labels: EnumLabels<K>,
  value: string,
  locale: "zh" | "en" = "zh",
): string {
  return (labels as EnumLabels<string>)[value]?.[locale] ?? value;
}

/** `<select>` options in dictionary order. */
export function optionsOf<K extends string>(
  labels: EnumLabels<K>,
  locale: "zh" | "en" = "zh",
): { value: K; label: string }[] {
  return (Object.entries(labels) as [K, { zh: string; en: string }][]).map(([value, text]) => ({
    value,
    label: text[locale],
  }));
}
