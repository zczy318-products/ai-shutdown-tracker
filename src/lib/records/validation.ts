import { z } from "zod";

import {
  ATTRIBUTION_CONFIDENCE_VALUES,
  COMPANY_SIZE_VALUES,
  EVENT_DATE_PRECISION_VALUES,
  IMPACT_TYPE_VALUES,
  INDUSTRY_VALUES,
  LINK_HEALTH_VALUES,
  OUTCOME_VALUES,
  RECORD_STATUS_VALUES,
  SOURCE_TYPE_VALUES,
  isCountryCode,
  regionForCountry,
} from "@/lib/enums";

/**
 * Layer 2 of the three-layer source guarantee (form → *schema* → database).
 *
 * These schemas run on the server inside the record actions. The browser form
 * also enforces `required` / `minLength` on the same fields, and
 * `drizzle/0002_record_integrity.sql` enforces the structural part in the
 * database. A request that bypasses the form still cannot write an unsourced
 * record.
 *
 * Nothing here derives attribution. `attributionConfidence` is a required
 * choice with no default and no inference from the sources — the only thing the
 * sources decide is whether a *claimed* grade is permitted (see `./publish.ts`).
 */

const trimmed = z.string().trim();

/** Postgres `date`, which drizzle reads and writes as `YYYY-MM-DD`. */
const isoDate = trimmed
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "日期不存在");

const httpUrl = trimmed
  .max(2000, "URL 过长")
  .regex(/^https?:\/\/\S+$/i, "必须是以 http:// 或 https:// 开头的完整 URL");

/** Treats an empty form field as "not provided" rather than as `""`. */
function optionalText(max: number, message = "内容过长") {
  return z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => value || null)
    .nullable()
    .default(null);
}

function optionalInt(opts: { min: number; max: number; message: string }) {
  return z
    .union([z.string().trim(), z.number(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined || value === "") return null;
      return typeof value === "number" ? value : Number(value);
    })
    .refine(
      (value) => value === null || (Number.isInteger(value) && value >= opts.min && value <= opts.max),
      opts.message,
    );
}

// ---------------------------------------------------------------------------
// source — the four mandatory fields are mandatory here too
// ---------------------------------------------------------------------------

export const sourceInputSchema = z.object({
  /** Present when editing an existing row; absent for a newly added one. */
  id: z.uuid().optional(),
  url: httpUrl,
  mediaName: trimmed.min(1, "请填写媒体 / 机构名").max(160, "媒体名过长"),
  sourceType: z.enum(SOURCE_TYPE_VALUES),
  publishedAt: isoDate,
  title: optionalText(500, "标题过长"),
  author: optionalText(200, "作者过长"),
  /**
   * The verbatim quote. The 20-character floor matches the database CHECK and
   * exists to stop a placeholder such as "AI" counting as evidence.
   */
  quote: trimmed
    .min(20, "原文引述至少 20 个字符（必须是来源原文里连续出现的一段文字）")
    .max(2000, "原文引述过长（上限 2000 字符）"),
  quoteLang: trimmed
    .toLowerCase()
    .regex(/^[a-z]{2}$/, "语言代码应为 2 位 ISO 639-1，如 en / zh / de")
    .default("en"),
  quoteTranslationZh: optionalText(2000, "译文过长"),
  archiveUrl: z
    .union([httpUrl, z.literal("")])
    .transform((value) => value || null)
    .nullable()
    .default(null),
  linkHealth: z.enum(LINK_HEALTH_VALUES).default("ok"),
  manuallyVerified: z.coerce.boolean().default(false),
});

export type SourceInput = z.infer<typeof sourceInputSchema>;

// ---------------------------------------------------------------------------
// company
// ---------------------------------------------------------------------------

export const companyInputSchema = z
  .object({
    slug: trimmed
      .min(1, "请填写 slug")
      .max(120, "slug 过长")
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug 只能用小写字母、数字和单个连字符，如 the-planet-d"),
    name: trimmed.min(1, "请填写公司名").max(200, "公司名过长"),
    nameZh: optionalText(200, "中文名过长"),
    /** One alias per line in the form; stored as `text[]`. */
    aliases: z
      .union([z.string(), z.array(z.string()), z.null(), z.undefined()])
      .transform((value) => {
        const raw = Array.isArray(value) ? value : (value ?? "").split(/[\n,]/);
        return Array.from(new Set(raw.map((item) => item.trim()).filter(Boolean))).slice(0, 30);
      }),
    countryCode: trimmed
      .toUpperCase()
      .refine(isCountryCode, "国家代码必须是 ISO 3166-1 alpha-2 白名单内的值（跨国用 ZZ）"),
    industry: z.enum(INDUSTRY_VALUES),
    companySize: z.enum(COMPANY_SIZE_VALUES).default("unknown"),
    foundedYear: optionalInt({
      min: 1800,
      max: new Date().getUTCFullYear(),
      message: `成立年份应在 1800 到 ${new Date().getUTCFullYear()} 之间`,
    }),
    websiteUrl: z
      .union([httpUrl, z.literal("")])
      .transform((value) => value || null)
      .nullable()
      .default(null),
    description: optionalText(2000, "简介过长"),
    logoUrl: z
      .union([httpUrl, z.literal("")])
      .transform((value) => value || null)
      .nullable()
      .default(null),
  })
  // Dictionary §1.2: region is derived, never chosen, so it cannot contradict
  // the country it is supposed to summarise.
  .transform((value) => ({ ...value, region: regionForCountry(value.countryCode) }));

export type CompanyInput = z.infer<typeof companyInputSchema>;

/**
 * Dictionary §2: a company description must not assert attribution — that is
 * what `ai_impact.summary` plus the sources are for. The dictionary asks for a
 * warning rather than a hard block, because a legitimate description can quote
 * the company's own framing.
 */
const ATTRIBUTION_PHRASES = [
  "因 AI 倒闭",
  "因 AI 关闭",
  "被 AI 杀死",
  "被 AI 干掉",
  "AI 导致倒闭",
  "killed by ai",
  "destroyed by ai",
];

export function describeDescriptionWarnings(description: string | null): string[] {
  if (!description) return [];
  const haystack = description.toLowerCase();
  return ATTRIBUTION_PHRASES.filter((phrase) => haystack.includes(phrase.toLowerCase())).map(
    (phrase) =>
      `公司简介里出现了断言式表述「${phrase}」。简介应只做客观业务描述，归因请放在事件陈述与来源引述里。`,
  );
}

// ---------------------------------------------------------------------------
// ai_impact
// ---------------------------------------------------------------------------

export const impactInputSchema = z.object({
  impactType: z.enum(IMPACT_TYPE_VALUES, { message: "请选择影响类型" }),
  /** No default anywhere in the stack: a grade is always a human choice. */
  attributionConfidence: z.enum(ATTRIBUTION_CONFIDENCE_VALUES, { message: "请选择归因置信度" }),
  outcome: z.enum(OUTCOME_VALUES, { message: "请选择结局" }),
  eventDate: isoDate,
  eventDatePrecision: z.enum(EVENT_DATE_PRECISION_VALUES).default("day"),
  summary: trimmed
    .min(30, "事件陈述至少 30 个字符")
    .max(800, "事件陈述过长（上限 800 字符）"),
  summaryEn: optionalText(2000, "英文陈述过长"),
  employeesAffected: optionalInt({
    min: 0,
    max: 10_000_000,
    message: "受影响人数应为 0 以上的整数",
  }),
  employeesAffectedPct: z
    .union([z.string().trim(), z.number(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined || value === "") return null;
      return typeof value === "number" ? value : Number(value);
    })
    .refine(
      (value) => value === null || (Number.isFinite(value) && value >= 0 && value <= 100),
      "受影响占比应在 0 到 100 之间",
    )
    // drizzle's `numeric` maps to a string so the decimal is not rounded by a float.
    .transform((value) => (value === null ? null : value.toFixed(2))),
  revenueImpactNote: optionalText(1000, "营收影响备注过长"),
  isPrimary: z.coerce.boolean().default(false),
  counterEvidence: optionalText(2000, "反方证据过长"),
  reviewNote: optionalText(1000, "审核意见过长"),
});

export type ImpactInput = z.infer<typeof impactInputSchema>;

// ---------------------------------------------------------------------------
// The whole record
// ---------------------------------------------------------------------------

export const recordInputSchema = z.object({
  company: companyInputSchema,
  impact: impactInputSchema,
  /**
   * The hard floor. `min(1)` is the schema half of "every record needs a
   * source"; the database half is the deferred constraint trigger.
   */
  sources: z
    .array(sourceInputSchema)
    .min(1, "每条记录至少需要一条来源（含 URL、媒体名、发布日期与原文引述），否则无法保存")
    .max(20, "单条记录最多 20 条来源")
    .superRefine((sources, ctx) => {
      const seen = new Map<string, number>();
      sources.forEach((item, index) => {
        const key = item.url.toLowerCase();
        const first = seen.get(key);
        if (first !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: [index, "url"],
            message: `与第 ${first + 1} 条来源的 URL 重复，同一事件下不能重复录入同一 URL`,
          });
          return;
        }
        seen.set(key, index);
      });
    }),
  /** Only `draft` / `in_review` are reachable from the editor. */
  status: z.enum(RECORD_STATUS_VALUES).default("draft"),
});

export type RecordInput = z.infer<typeof recordInputSchema>;

/**
 * Flattens zod issues into `{ "sources.0.quote": "message" }`, which is what
 * the form reads to put each message under the field that caused it. Without
 * the path a rejected save would show one opaque error for a form this size.
 */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    errors[key] ??= issue.message;
  }
  return errors;
}
