import Link from "next/link";

import { DataUnavailable } from "@/components/public/data-unavailable";
import { AttributionBadge, ImpactTypeBadge, OutcomeBadge } from "@/components/public/record-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  ATTRIBUTION_CONFIDENCE,
  IMPACT_TYPE,
  INDUSTRY,
  countryLabel,
  labelOf,
  optionsOf,
} from "@/lib/enums";
import { formatEventDateCompact } from "@/lib/format";
import {
  PUBLIC_PAGE_SIZE,
  PUBLIC_SORTS,
  getPublicFilterOptions,
  hasActiveFilters,
  listPublicRecords,
  loadPublic,
  parsePublicFilters,
  publicListingHref,
  type PublicFilters,
  type RawSearchParams,
} from "@/lib/records/public";

/**
 * The listing: every published record, filterable and paginated.
 *
 * Filter state lives **only** in the URL. The page holds none of its own, so a
 * reload, a bookmark and a pasted link all reproduce the same view — which is
 * also what makes the acceptance run reproducible, since a filter combination
 * is just a URL with a row count attached to it.
 *
 * The form is a plain `method="get"` form of native selects: no client
 * JavaScript, no hydration, and it degrades to working links. Unrecognised
 * query values are dropped by `parsePublicFilters` rather than raising, so a
 * stale shared link lands on the unfiltered listing instead of an error page.
 *
 * Visibility is not this page's decision: `listPublicRecords` filters on
 * `record_status = 'published'` inside the query.
 */

export const dynamic = "force-dynamic";

export default async function ListingPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const filters = parsePublicFilters(await searchParams);
  const result = await loadPublic(() =>
    Promise.all([listPublicRecords(filters), getPublicFilterOptions()]),
  );
  // A read failure is its own state, never an empty listing — see `loadPublic`.
  if (!result.ok) return <DataUnavailable retryHref={publicListingHref(filters)} />;

  const [{ items, total, page, pageCount }, options] = result.data;
  const filtered = hasActiveFilters(filters);

  return (
    <div className="space-y-8">
      <section className="max-w-3xl space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          被 AI 改写的公司名单
          <span className="text-muted-foreground ml-2 align-middle text-base font-normal">
            Rest In Prompts
          </span>
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          这里收录在公开报道中被归因于 AI 的倒闭、裁员与转型事件。每条记录都附原文链接与逐字引述，
          并按 ZCZ-2 归因标准人工评出置信度——本站不替任何一方下结论，只把别人说过的话固定住，
          并如实标注证据有多硬、以及有哪些反方说法。
        </p>
      </section>

      <FilterBar filters={filters} options={options} />

      {/*
        The `data-result-*` attributes are a testability affordance: the
        acceptance script (`npm run verify:public`) asserts filter combinations
        against these rather than scraping the rendered Chinese prose, so the
        numbers in the task report are the numbers the page served.
      */}
      <section
        className="space-y-4"
        data-result-total={total}
        data-result-page={page}
        data-result-pages={pageCount}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">
            {filtered ? "筛选结果" : "全部记录"}
            <span className="text-muted-foreground ml-2 font-mono text-xs">{total} 条</span>
          </h2>
          {pageCount > 1 ? (
            <span className="text-muted-foreground font-mono text-xs">
              第 {page} / {pageCount} 页 · 每页 {PUBLIC_PAGE_SIZE} 条
            </span>
          ) : null}
        </div>

        {items.length === 0 ? (
          <div className="text-muted-foreground rounded-xl border border-dashed p-12 text-center text-sm">
            {filtered ? (
              <>
                <p>没有符合这些筛选条件的记录。</p>
                <Link href="/" className="mt-2 inline-block underline">
                  清除筛选，查看全部
                </Link>
              </>
            ) : (
              <>
                <p>还没有已发布的记录。</p>
                <p className="mt-1 text-xs">
                  记录需要先在后台通过审核并发布，才会出现在这里——草稿与待审稿不会公开。
                </p>
              </>
            )}
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map(({ impact, company, sourceCount }) => (
              <li
                key={impact.id}
                data-record-id={impact.id}
                data-company-slug={company.slug}
                data-event-date={impact.eventDate}
                data-confidence={impact.attributionConfidence}
                data-impact-type={impact.impactType}
              >
                {/* 墓碑卡片（设计规范 §6）：石灰描边的圆角档案卡，不做拟物。 */}
                <article className="bg-card flex h-full flex-col gap-3 rounded-xl border p-5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                      {formatEventDateCompact(impact.eventDate, impact.eventDatePrecision)}
                    </span>
                    <OutcomeBadge outcome={impact.outcome} />
                  </div>

                  <div className="space-y-1">
                    <h3 className="leading-tight font-medium">
                      {/*
                        The card's primary link, and at one tight line it came
                        out 19 CSS px tall — under WCAG 2.2 §2.5.8's 24 px.
                        `inline-block` rather than `inline-flex`, so a long
                        company name still wraps; the negative margin keeps the
                        card's vertical rhythm unchanged.
                      */}
                      <Link
                        href={`/company/${company.slug}`}
                        className="-my-1 inline-block py-1 hover:underline"
                      >
                        {company.nameZh && company.nameZh !== company.name
                          ? `${company.name}（${company.nameZh}）`
                          : company.name}
                      </Link>
                    </h3>
                    <p className="text-muted-foreground text-xs">
                      {labelOf(INDUSTRY, company.industry)} · {countryLabel(company.countryCode)}
                    </p>
                  </div>

                  <p className="text-muted-foreground line-clamp-4 text-sm leading-relaxed">
                    {impact.summary}
                  </p>

                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    <ImpactTypeBadge impactType={impact.impactType} />
                    <AttributionBadge confidence={impact.attributionConfidence} />
                    {/* The grade must always be one click from the evidence. */}
                    <Link
                      href={`/company/${company.slug}#sources-${impact.id}`}
                      className="text-muted-foreground hover:text-foreground rounded-md border px-2 py-0.5 text-xs underline-offset-2 hover:underline"
                    >
                      {sourceCount} 条来源
                    </Link>
                    {impact.counterEvidence ? (
                      <Badge variant="outline" title="该记录登记了反方证据或其他归因说法">
                        有反方证据
                      </Badge>
                    ) : null}
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}

        {pageCount > 1 ? (
          <nav className="flex items-center justify-between gap-4 pt-2" aria-label="分页">
            {page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={publicListingHref(filters, { page: page - 1 })}>← 上一页</Link>
              </Button>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground font-mono text-xs">
              {page} / {pageCount}
            </span>
            {page < pageCount ? (
              <Button asChild variant="outline" size="sm">
                <Link href={publicListingHref(filters, { page: page + 1 })}>下一页 →</Link>
              </Button>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}

/**
 * One row of filters above the results (spec §4.6), all five combinable.
 *
 * Year, industry and country are offered **only with the values that occur in
 * published data**, with counts: a dropdown of 21 industries and ~250 countries
 * where most would return nothing is a worse control than a short list of what
 * is actually there. Impact type and confidence are small fixed enums, so they
 * are listed in full — a zero-count option is itself a fact about the dataset.
 */
function FilterBar({
  filters,
  options,
}: {
  filters: PublicFilters;
  options: Awaited<ReturnType<typeof getPublicFilterOptions>>;
}) {
  return (
    <form action="/" method="get" className="bg-card space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="关键词（公司名 / 中文名 / 别名）" htmlFor="f-q">
          <Input
            id="f-q"
            name="q"
            defaultValue={filters.q}
            placeholder="chegg"
            className="w-56"
          />
        </Field>

        <Field label="年份" htmlFor="f-year">
          <Select id="f-year" name="year" defaultValue={filters.year ?? ""} className="w-32">
            <option value="">全部</option>
            {options.years.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value}（{option.count}）
              </option>
            ))}
          </Select>
        </Field>

        <Field label="行业" htmlFor="f-industry">
          <Select
            id="f-industry"
            name="industry"
            defaultValue={filters.industry ?? ""}
            className="w-52"
          >
            <option value="">全部</option>
            {options.industries.map((option) => (
              <option key={option.value} value={option.value}>
                {labelOf(INDUSTRY, option.value)}（{option.count}）
              </option>
            ))}
          </Select>
        </Field>

        <Field label="国家 / 地区" htmlFor="f-country">
          <Select
            id="f-country"
            name="country"
            defaultValue={filters.country ?? ""}
            className="w-44"
          >
            <option value="">全部</option>
            {options.countries.map((option) => (
              <option key={option.value} value={option.value}>
                {countryLabel(option.value)}（{option.count}）
              </option>
            ))}
          </Select>
        </Field>

        <Field label="影响类型" htmlFor="f-impact">
          <Select
            id="f-impact"
            name="impactType"
            defaultValue={filters.impactType ?? ""}
            className="w-48"
          >
            <option value="">全部</option>
            {optionsOf(IMPACT_TYPE).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}（{options.impactTypes.get(option.value) ?? 0}）
              </option>
            ))}
          </Select>
        </Field>

        <Field label="归因置信度" htmlFor="f-confidence">
          <Select
            id="f-confidence"
            name="confidence"
            defaultValue={filters.confidence ?? ""}
            className="w-36"
          >
            <option value="">全部</option>
            {optionsOf(ATTRIBUTION_CONFIDENCE).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}（{options.confidences.get(option.value) ?? 0}）
              </option>
            ))}
          </Select>
        </Field>

        <Field label="排序" htmlFor="f-sort">
          <Select id="f-sort" name="sort" defaultValue={filters.sort} className="w-44">
            {Object.entries(PUBLIC_SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-center gap-2">
          <Button type="submit" variant="secondary">
            筛选
          </Button>
          {hasActiveFilters(filters) || filters.sort !== "date_desc" ? (
            <Button asChild variant="ghost">
              <Link href="/">清除</Link>
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        括号内是该取值在<strong className="font-medium">已发布</strong>
        记录中的条数；多个条件可以组合，筛选状态会写进地址栏，刷新或分享后保持不变。
      </p>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-muted-foreground block text-xs">
        {label}
      </label>
      {children}
    </div>
  );
}
