"use client";

import { useActionState, useId, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ATTRIBUTION_CONFIDENCE,
  COMPANY_SIZE,
  COUNTRY_CODES,
  EVENT_DATE_PRECISION,
  IMPACT_TYPE,
  INDUSTRY,
  LINK_HEALTH,
  OUTCOME,
  SOURCE_TYPE,
  countryLabel,
  optionsOf,
  regionForCountry,
  REGION,
  labelOf,
  type RecordStatus,
} from "@/lib/enums";

import type { RecordFormState } from "./actions";

/**
 * The record editor: company fields, impact fields, and a repeatable list of
 * sources with at least one row that cannot be removed.
 *
 * Layer 1 of the three-layer source guarantee. The browser's own `required` /
 * `minlength` stop the common mistakes before a round trip — but they are only
 * a convenience. The authoritative checks are `recordInputSchema` and
 * `checkPublishable` on the server, and the constraints in Postgres; see
 * `src/app/admin/records/actions.ts`.
 *
 * The form posts as a real form (native `<select>`, no controlled inputs) so
 * the action receives ordinary `FormData` and a failed submit comes back with
 * every typed value still in place.
 */

export type SourceDefaults = {
  id?: string;
  url?: string;
  mediaName?: string;
  sourceType?: string;
  publishedAt?: string;
  title?: string | null;
  author?: string | null;
  quote?: string;
  quoteLang?: string;
  quoteTranslationZh?: string | null;
  archiveUrl?: string | null;
  linkHealth?: string;
  manuallyVerified?: boolean;
};

export type RecordDefaults = {
  impactId?: string;
  status?: RecordStatus;
  company?: {
    slug?: string;
    name?: string;
    nameZh?: string | null;
    aliases?: string[];
    countryCode?: string;
    industry?: string;
    companySize?: string;
    foundedYear?: number | null;
    websiteUrl?: string | null;
    description?: string | null;
    logoUrl?: string | null;
  };
  impact?: {
    impactType?: string;
    attributionConfidence?: string;
    outcome?: string;
    eventDate?: string;
    eventDatePrecision?: string;
    summary?: string;
    summaryEn?: string | null;
    employeesAffected?: number | null;
    employeesAffectedPct?: string | null;
    revenueImpactNote?: string | null;
    isPrimary?: boolean;
    counterEvidence?: string | null;
    reviewNote?: string | null;
  };
  sources?: SourceDefaults[];
};

type Props = {
  action: (prev: RecordFormState, formData: FormData) => Promise<RecordFormState>;
  defaults?: RecordDefaults;
  mode: "create" | "edit";
};

/** `""` rather than `undefined`, which React treats as uncontrolled-with-no-value. */
function v(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-xs">
      {message}
    </p>
  );
}

export function RecordForm({ action, defaults, mode }: Props) {
  const [state, formAction, pending] = useActionState<RecordFormState, FormData>(action, null);
  const errors = state?.fieldErrors ?? {};

  const initialSources = useMemo<SourceDefaults[]>(
    () => (defaults?.sources?.length ? defaults.sources : [{}]),
    [defaults?.sources],
  );
  // Stable keys so React does not remount (and so blank out) the rows below a
  // removed one — the `name` attributes are index-based and shift on removal.
  const [rows, setRows] = useState(() =>
    initialSources.map((item, index) => ({ key: `${index}-${item.id ?? "new"}`, item })),
  );
  const keySeed = useId();

  const [countryCode, setCountryCode] = useState(defaults?.company?.countryCode ?? "US");

  const addRow = () =>
    setRows((current) => [...current, { key: `${keySeed}-${current.length}-${Date.now()}`, item: {} }]);
  const removeRow = (key: string) =>
    setRows((current) => (current.length <= 1 ? current : current.filter((row) => row.key !== key)));

  return (
    <form action={formAction} className="space-y-6">
      {defaults?.impactId ? <input type="hidden" name="impactId" value={defaults.impactId} /> : null}

      {state?.errors?.length ? (
        <div role="alert" className="border-destructive/50 bg-destructive/10 space-y-1 rounded-md border p-4 text-sm">
          {state.errors.map((message, index) => (
            <p key={index} className={index === 0 ? "font-medium" : "pl-4"}>
              {message}
            </p>
          ))}
        </div>
      ) : null}

      {state?.ok ? (
        <div role="status" className="rounded-md border border-emerald-600/40 bg-emerald-600/10 p-4 text-sm">
          已保存。
        </div>
      ) : null}

      {state?.warnings?.length ? (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">提醒（不影响保存）</p>
          {state.warnings.map((message, index) => (
            <p key={index} className="pl-4">
              {message}
            </p>
          ))}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>公司</CardTitle>
          <CardDescription>
            按 slug 关联：填已存在的 slug 会更新那家公司，并把这条事件挂在它下面。
            公司简介只做客观业务描述，归因写在下面的事件陈述里。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="company-slug">slug（URL 用）*</Label>
            <Input
              id="company-slug"
              name="company.slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              defaultValue={v(defaults?.company?.slug)}
              placeholder="the-planet-d"
              aria-invalid={Boolean(errors["company.slug"])}
            />
            <FieldError message={errors["company.slug"]} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="company-name">公司 / 品牌名 *</Label>
            <Input
              id="company-name"
              name="company.name"
              required
              maxLength={200}
              defaultValue={v(defaults?.company?.name)}
              placeholder="Chegg, Inc."
              aria-invalid={Boolean(errors["company.name"])}
            />
            <FieldError message={errors["company.name"]} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="company-name-zh">中文名</Label>
            <Input
              id="company-name-zh"
              name="company.nameZh"
              maxLength={200}
              defaultValue={v(defaults?.company?.nameZh)}
            />
            <FieldError message={errors["company.nameZh"]} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="company-aliases">别名（每行一个）</Label>
            <Textarea
              id="company-aliases"
              name="company.aliases"
              rows={2}
              defaultValue={(defaults?.company?.aliases ?? []).join("\n")}
              placeholder={"Chegg Inc\nCHGG"}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="company-country">国家 / 地区 *</Label>
            <Select
              id="company-country"
              name="company.countryCode"
              required
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value)}
              aria-invalid={Boolean(errors["company.countryCode"])}
            >
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>
                  {code} — {countryLabel(code)}
                </option>
              ))}
            </Select>
            <p className="text-muted-foreground text-xs">
              大区自动推导为「{labelOf(REGION, regionForCountry(countryCode))}」，不单独填写。
              跨国 / 无法归属选 ZZ。
            </p>
            <FieldError message={errors["company.countryCode"]} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="company-industry">行业 *</Label>
            <Select
              id="company-industry"
              name="company.industry"
              required
              defaultValue={v(defaults?.company?.industry) || "other"}
            >
              {optionsOf(INDUSTRY).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <FieldError message={errors["company.industry"]} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="company-size">规模（事件发生前）</Label>
            <Select
              id="company-size"
              name="company.companySize"
              defaultValue={v(defaults?.company?.companySize) || "unknown"}
            >
              {optionsOf(COMPANY_SIZE).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="company-founded">成立年份</Label>
            <Input
              id="company-founded"
              name="company.foundedYear"
              type="number"
              min={1800}
              max={new Date().getUTCFullYear()}
              defaultValue={v(defaults?.company?.foundedYear)}
              aria-invalid={Boolean(errors["company.foundedYear"])}
            />
            <FieldError message={errors["company.foundedYear"]} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="company-website">官网</Label>
            <Input
              id="company-website"
              name="company.websiteUrl"
              type="url"
              defaultValue={v(defaults?.company?.websiteUrl)}
              placeholder="https://www.chegg.com"
              aria-invalid={Boolean(errors["company.websiteUrl"])}
            />
            <FieldError message={errors["company.websiteUrl"]} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="company-logo">Logo URL</Label>
            <Input
              id="company-logo"
              name="company.logoUrl"
              type="url"
              defaultValue={v(defaults?.company?.logoUrl)}
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="company-description">业务简介（1–3 句，不含归因）</Label>
            <Textarea
              id="company-description"
              name="company.description"
              rows={2}
              maxLength={2000}
              defaultValue={v(defaults?.company?.description)}
              placeholder="美国在线作业辅导与教材租赁平台，主营按月订阅的习题解答服务。"
            />
            <FieldError message={errors["company.description"]} />
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>AI 影响事件</CardTitle>
          <CardDescription>
            影响类型与归因置信度都没有默认值，必须人工选择。置信度评的是「把 AI
            列为该事件原因，这个说法的证据有多硬」，不是「这家公司是否真的因 AI 倒闭」。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="impact-type">影响类型 *</Label>
            <Select
              id="impact-type"
              name="impact.impactType"
              required
              defaultValue={v(defaults?.impact?.impactType)}
              aria-invalid={Boolean(errors["impact.impactType"])}
            >
              <option value="">— 请选择 —</option>
              {optionsOf(IMPACT_TYPE).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <FieldError message={errors["impact.impactType"]} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="impact-confidence">归因置信度 *</Label>
            <Select
              id="impact-confidence"
              name="impact.attributionConfidence"
              required
              defaultValue={v(defaults?.impact?.attributionConfidence)}
              aria-invalid={Boolean(errors["impact.attributionConfidence"])}
            >
              <option value="">— 请选择 —</option>
              {optionsOf(ATTRIBUTION_CONFIDENCE).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <p className="text-muted-foreground text-xs">
              评「高」时必须有至少一条「公司一手材料」或「主流媒体原创报道」来源，发布时会校验。
            </p>
            <FieldError message={errors["impact.attributionConfidence"]} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="impact-outcome">结局 *</Label>
            <Select
              id="impact-outcome"
              name="impact.outcome"
              required
              defaultValue={v(defaults?.impact?.outcome)}
              aria-invalid={Boolean(errors["impact.outcome"])}
            >
              <option value="">— 请选择 —</option>
              {optionsOf(OUTCOME).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <FieldError message={errors["impact.outcome"]} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="impact-date">事件日期 *</Label>
              <Input
                id="impact-date"
                name="impact.eventDate"
                type="date"
                required
                defaultValue={v(defaults?.impact?.eventDate)}
                aria-invalid={Boolean(errors["impact.eventDate"])}
              />
              <FieldError message={errors["impact.eventDate"]} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="impact-precision">日期精度</Label>
              <Select
                id="impact-precision"
                name="impact.eventDatePrecision"
                defaultValue={v(defaults?.impact?.eventDatePrecision) || "day"}
              >
                {optionsOf(EVENT_DATE_PRECISION).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="impact-summary">事件陈述（中文，30–800 字符）*</Label>
            <Textarea
              id="impact-summary"
              name="impact.summary"
              required
              minLength={30}
              maxLength={800}
              rows={4}
              defaultValue={v(defaults?.impact?.summary)}
              placeholder="据 CNBC 等媒体报道，……（必须是转述句式，不要写成平台自己的结论）"
              aria-invalid={Boolean(errors["impact.summary"])}
            />
            <FieldError message={errors["impact.summary"]} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="impact-employees">受影响人数</Label>
            <Input
              id="impact-employees"
              name="impact.employeesAffected"
              type="number"
              min={0}
              defaultValue={v(defaults?.impact?.employeesAffected)}
              aria-invalid={Boolean(errors["impact.employeesAffected"])}
            />
            <FieldError message={errors["impact.employeesAffected"]} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="impact-pct">受影响占比（%）</Label>
            <Input
              id="impact-pct"
              name="impact.employeesAffectedPct"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={v(defaults?.impact?.employeesAffectedPct)}
              aria-invalid={Boolean(errors["impact.employeesAffectedPct"])}
            />
            <FieldError message={errors["impact.employeesAffectedPct"]} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="impact-revenue">营收 / 股价影响备注</Label>
            <Input
              id="impact-revenue"
              name="impact.revenueImpactNote"
              defaultValue={v(defaults?.impact?.revenueImpactNote)}
              placeholder="据报道，公司市值自 ChatGPT 发布以来累计下跌约 99%。"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="impact-counter">反方证据</Label>
            <Textarea
              id="impact-counter"
              name="impact.counterEvidence"
              rows={3}
              maxLength={2000}
              defaultValue={v(defaults?.impact?.counterEvidence)}
              placeholder="公司否认、分析师提出的其他原因等。置信度为「中」/「低」时强烈建议填写。"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="impact-summary-en">英文陈述（可留空）</Label>
            <Textarea
              id="impact-summary-en"
              name="impact.summaryEn"
              rows={2}
              defaultValue={v(defaults?.impact?.summaryEn)}
            />
          </div>

          <label className="flex items-start gap-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              name="impact.isPrimary"
              defaultChecked={defaults?.impact?.isPrimary ?? false}
              className="border-input mt-0.5 size-4 rounded border"
            />
            <span>
              设为该公司的主事件
              <span className="text-muted-foreground block text-xs">
                榜单每家公司只展示一条。每家公司最多一条主事件，重复勾选会被数据库拒绝。
              </span>
            </span>
          </label>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="impact-review-note">审核意见</Label>
            <Textarea
              id="impact-review-note"
              name="impact.reviewNote"
              rows={2}
              defaultValue={v(defaults?.impact?.reviewNote)}
              placeholder="拒收时必填。"
              aria-invalid={Boolean(errors["impact.reviewNote"])}
            />
            <FieldError message={errors["impact.reviewNote"]} />
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            来源
            <Badge variant="outline">至少 1 条</Badge>
          </CardTitle>
          <CardDescription>
            每条来源的 URL、媒体名、发布日期、原文引述都必填。原文引述必须是来源原文里
            <strong>连续出现</strong>的一段文字，保留原文语言 —— 不翻译、不改写、不拼接跨段句子。
            译文填在单独的字段里，前台会标注「译文（非原文）」。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {errors.sources ? <FieldError message={errors.sources} /> : null}

          {rows.map((row, index) => (
            <fieldset key={row.key} className="space-y-4 rounded-lg border p-4">
              <legend className="flex items-center gap-2 px-1 text-sm font-medium">
                来源 {index + 1}
                {rows.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRow(row.key)}
                    className="text-destructive h-6 px-2"
                  >
                    移除
                  </Button>
                ) : (
                  <span className="text-muted-foreground text-xs">（最后一条不可移除）</span>
                )}
              </legend>

              {row.item.id ? (
                <input type="hidden" name={`sources.${index}.id`} value={row.item.id} />
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`src-${index}-url`}>URL *</Label>
                  <Input
                    id={`src-${index}-url`}
                    name={`sources.${index}.url`}
                    type="url"
                    required
                    defaultValue={v(row.item.url)}
                    placeholder="https://www.cnbc.com/2025/…"
                    aria-invalid={Boolean(errors[`sources.${index}.url`])}
                  />
                  <FieldError message={errors[`sources.${index}.url`]} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`src-${index}-media`}>媒体 / 机构名 *</Label>
                  <Input
                    id={`src-${index}-media`}
                    name={`sources.${index}.mediaName`}
                    required
                    maxLength={160}
                    defaultValue={v(row.item.mediaName)}
                    placeholder="CNBC"
                    aria-invalid={Boolean(errors[`sources.${index}.mediaName`])}
                  />
                  <FieldError message={errors[`sources.${index}.mediaName`]} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`src-${index}-type`}>来源类型 *</Label>
                  <Select
                    id={`src-${index}-type`}
                    name={`sources.${index}.sourceType`}
                    required
                    defaultValue={v(row.item.sourceType)}
                    aria-invalid={Boolean(errors[`sources.${index}.sourceType`])}
                  >
                    <option value="">— 请选择 —</option>
                    {optionsOf(SOURCE_TYPE).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <FieldError message={errors[`sources.${index}.sourceType`]} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`src-${index}-published`}>发布日期 *</Label>
                  <Input
                    id={`src-${index}-published`}
                    name={`sources.${index}.publishedAt`}
                    type="date"
                    required
                    defaultValue={v(row.item.publishedAt)}
                    aria-invalid={Boolean(errors[`sources.${index}.publishedAt`])}
                  />
                  <FieldError message={errors[`sources.${index}.publishedAt`]} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`src-${index}-lang`}>原文语言</Label>
                  <Input
                    id={`src-${index}-lang`}
                    name={`sources.${index}.quoteLang`}
                    maxLength={2}
                    pattern="[A-Za-z]{2}"
                    defaultValue={v(row.item.quoteLang) || "en"}
                    placeholder="en"
                  />
                  <FieldError message={errors[`sources.${index}.quoteLang`]} />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`src-${index}-quote`}>原文引述（verbatim，20–2000 字符）*</Label>
                  <Textarea
                    id={`src-${index}-quote`}
                    name={`sources.${index}.quote`}
                    required
                    minLength={20}
                    maxLength={2000}
                    rows={3}
                    defaultValue={v(row.item.quote)}
                    placeholder="从原文直接复制的一段连续文字。省略用 … 标记，补语法的词用 [方括号]。"
                    aria-invalid={Boolean(errors[`sources.${index}.quote`])}
                  />
                  <FieldError message={errors[`sources.${index}.quote`]} />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`src-${index}-translation`}>中文译文（可选，人工翻译）</Label>
                  <Textarea
                    id={`src-${index}-translation`}
                    name={`sources.${index}.quoteTranslationZh`}
                    rows={2}
                    defaultValue={v(row.item.quoteTranslationZh)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`src-${index}-title`}>原文标题</Label>
                  <Input
                    id={`src-${index}-title`}
                    name={`sources.${index}.title`}
                    defaultValue={v(row.item.title)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`src-${index}-author`}>作者</Label>
                  <Input
                    id={`src-${index}-author`}
                    name={`sources.${index}.author`}
                    maxLength={200}
                    defaultValue={v(row.item.author)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`src-${index}-health`}>链接状态</Label>
                  <Select
                    id={`src-${index}-health`}
                    name={`sources.${index}.linkHealth`}
                    defaultValue={v(row.item.linkHealth) || "ok"}
                  >
                    {optionsOf(LINK_HEALTH).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`src-${index}-archive`}>归档快照 URL</Label>
                  <Input
                    id={`src-${index}-archive`}
                    name={`sources.${index}.archiveUrl`}
                    type="url"
                    defaultValue={v(row.item.archiveUrl)}
                    placeholder="https://web.archive.org/web/…"
                  />
                  <FieldError message={errors[`sources.${index}.archiveUrl`]} />
                </div>

                <label className="flex items-start gap-3 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    name={`sources.${index}.manuallyVerified`}
                    defaultChecked={row.item.manuallyVerified ?? false}
                    className="border-input mt-0.5 size-4 rounded border"
                  />
                  <span>
                    已人工在浏览器中确认可访问
                    <span className="text-muted-foreground block text-xs">
                      链接状态为「反爬拦截」时，必须勾选本项才能发布。
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          ))}

          <Button type="button" variant="outline" onClick={addRow}>
            + 增加一条来源
          </Button>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="submit" name="status" value="draft" variant="outline" disabled={pending}>
          {pending ? "处理中…" : "保存为草稿"}
        </Button>
        <Button type="submit" name="status" value="in_review" variant="secondary" disabled={pending}>
          保存并提交审核
        </Button>
        <Button type="submit" name="status" value="published" disabled={pending}>
          {mode === "create" ? "保存并发布" : "保存并发布"}
        </Button>
        <p className="text-muted-foreground w-full text-xs">
          发布前会校验来源完整性：至少一条来源、每条来源四项必填、置信度为「高」需一手或主流媒体来源、
          不得所有来源都已失效。任一条不满足都会拒绝并列出具体原因。
        </p>
      </div>
    </form>
  );
}
