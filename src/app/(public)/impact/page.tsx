import Link from "next/link";
import { ArrowRight, Building2, Database, ExternalLink, Files, Info, Layers, Search, SlidersHorizontal, Table2 } from "lucide-react";

import { DataUnavailable } from "@/components/public/data-unavailable";
import { AttributionBadge, OutcomeBadge } from "@/components/public/record-badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ATTRIBUTION_CONFIDENCE, IMPACT_TYPE, INDUSTRY, countryLabel, labelOf, optionsOf } from "@/lib/enums";
import { formatEventDateCompact } from "@/lib/format";
import {
  PUBLIC_PAGE_SIZE, PUBLIC_SORTS, getPublicFilterOptions, getPublicStats,
  hasActiveFilters, listPublicRecords, loadPublic, parsePublicFilters,
  publicListingHref, type PublicFilters, type RawSearchParams,
} from "@/lib/records/public";

export const dynamic = "force-dynamic";

export default async function ListingPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const filters = parsePublicFilters(await searchParams);
  const result = await loadPublic(() => Promise.all([
    listPublicRecords(filters), getPublicFilterOptions(), getPublicStats(),
  ]));
  if (!result.ok) return <DataUnavailable retryHref={publicListingHref(filters)} />;

  const [{ items, total, page, pageCount }, options, stats] = result.data;
  const filtered = hasActiveFilters(filters);
  const metrics = [
    { label: "收录公司", value: stats.companies, unit: "家", note: "独立公司", Icon: Building2 },
    { label: "影响事件", value: stats.records, unit: "条", note: "按事件收录", Icon: Files },
    { label: "来源引用", value: stats.sources, unit: "条", note: "按事件计数", Icon: ExternalLink },
    { label: "覆盖行业", value: options.industries.length, unit: "类", note: "跨行业观察", Icon: Layers },
  ];

  return (
    <div className="archive-workspace">
      <section className="workspace-heading" aria-labelledby="archive-title">
        <div>
          <p className="workspace-eyebrow"><Database aria-hidden="true" /> AI IMPACT DATABASE</p>
          <h1 id="archive-title">AI 影响事件档案</h1>
          <p className="workspace-description">查阅裁员、转型与其他影响事件。这些记录不计入首页的公司停运名单。</p>
        </div>
        <details className="archive-method">
          <summary><Info aria-hidden="true" /> 收录与归因标准</summary>
          <div>
            <p>记录转述公开来源的说法，每条附原文链接、逐字引述与归因置信度。置信度衡量证据强度，不代表独立因果认定。</p>
            <p>同一家公司可以有多次事件；宣布缩编不等同于已完成裁员。反方证据与后续撤回记录一并保留。</p>
            <p>记录可能由自动化流程收集与整理；发布状态不等同于逐条人工核验，请以原文为准。</p>
          </div>
        </details>
      </section>

      <section className="archive-metrics" aria-label="已发布资料概览">
        {metrics.map(({ label, value, unit, note, Icon }) => (
          <div className="archive-metric" key={label}>
            <span className="metric-icon"><Icon aria-hidden="true" /></span>
            <div><p>{label}</p><strong>{value}</strong><span className="metric-unit">{unit}</span></div>
            <span className="metric-note">{note}</span>
          </div>
        ))}
      </section>

      <section id="records" className="archive-records" data-result-total={total} data-result-page={page} data-result-pages={pageCount} aria-labelledby="records-title">
        <div className="archive-section-heading">
          <h2 id="records-title">{filtered ? "筛选结果" : "全部公司档案"}<span>{total}</span></h2>
          <span className="archive-view-label"><Table2 aria-hidden="true" /> 表格视图</span>
        </div>
        <div className="archive-panel">
          <FilterBar filters={filters} options={options} />
          <div className="archive-listing-toolbar">
            <p role="status">共 {total} 条记录{total > 0 ? ` · 显示第 ${(page - 1) * PUBLIC_PAGE_SIZE + 1}–${Math.min(page * PUBLIC_PAGE_SIZE, total)} 条` : ""}</p>
            <Field label="排序" htmlFor="f-sort">
              <Select id="f-sort" name="sort" form="archive-filters" defaultValue={filters.sort}>
                {Object.entries(PUBLIC_SORTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
          </div>
          <p className="archive-scroll-hint" id="archive-scroll-help"><span><ArrowRight aria-hidden="true" /> 横向滚动查看摘要、置信度与来源</span><span>公司列已固定</span></p>
          <div className="archive-table-scroll" role="region" aria-label="公司影响事件表，可横向滚动" aria-describedby="archive-scroll-help" tabIndex={0}>
            <table className="archive-table">
              <caption className="sr-only">公开报道中的公司影响事件；来源链接可查阅原文引述与反方证据。</caption>
              <colgroup><col className="col-company" /><col className="col-date" /><col className="col-impact" /><col className="col-summary" /><col className="col-confidence" /><col className="col-source" /></colgroup>
              <thead><tr>
                <th scope="col">公司 / 行业</th>
                <th scope="col" aria-sort={filters.sort === "date_asc" ? "ascending" : filters.sort === "date_desc" ? "descending" : "none"}>事件日期 {filters.sort === "date_asc" ? "↑" : filters.sort === "date_desc" ? "↓" : ""}</th>
                <th scope="col">影响类型 / 结果</th><th scope="col">事件摘要</th><th scope="col">归因置信度</th><th scope="col">公开来源</th>
              </tr></thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={6} className="archive-empty">
                    <p>{filtered ? "没有符合这些筛选条件的记录。" : "还没有已发布的记录。"}</p>
                    {filtered ? <Link href="/impact">清除筛选，查看全部</Link> : <p>草稿与待审稿不会公开，发布后会出现在这里。</p>}
                  </td></tr>
                ) : items.map(({ impact, company, sourceCount }) => (
                  <tr key={impact.id} data-record-id={impact.id} data-company-slug={company.slug} data-event-date={impact.eventDate} data-confidence={impact.attributionConfidence} data-impact-type={impact.impactType}>
                    <th scope="row">
                      <div className="archive-company">
                        <span className="archive-monogram" aria-hidden="true">{company.name.charAt(0)}</span>
                        <div>
                          <Link href={`/company/${company.slug}`} className="archive-company-link">{company.name}</Link>
                          {company.nameZh && company.nameZh !== company.name ? <span className="archive-company-zh">{company.nameZh}</span> : null}
                          <p>{labelOf(INDUSTRY, company.industry)} · {countryLabel(company.countryCode)}</p>
                        </div>
                      </div>
                    </th>
                    <td><time dateTime={impact.eventDate}>{formatEventDateCompact(impact.eventDate, impact.eventDatePrecision)}</time></td>
                    <td><span className="archive-impact-label">{labelOf(IMPACT_TYPE, impact.impactType)}</span><OutcomeBadge outcome={impact.outcome} /></td>
                    <td><p className="archive-summary">{impact.summary}</p>{impact.counterEvidence ? <Link className="archive-counter" href={`/company/${company.slug}#event-${impact.id}`}><Info aria-hidden="true" /> 有反方证据</Link> : null}</td>
                    <td><AttributionBadge confidence={impact.attributionConfidence} /></td>
                    <td><Link className="archive-source-link" href={`/company/${company.slug}#sources-${impact.id}`} aria-label={`查看 ${company.name} 的 ${sourceCount} 条来源`}>{sourceCount} 条来源<ExternalLink aria-hidden="true" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="archive-table-bottom">
            <p>同一公司可能有多次事件 · 每页 {PUBLIC_PAGE_SIZE} 条</p>
            <nav aria-label="分页" className="archive-pagination">
              {page > 1 ? <Button asChild variant="outline" size="sm"><Link href={publicListingHref(filters, { page: page - 1 })}>← 上一页</Link></Button> : null}
              <span>第 {page} / {pageCount} 页</span>
              {page < pageCount ? <Button asChild variant="outline" size="sm"><Link href={publicListingHref(filters, { page: page + 1 })}>下一页 →</Link></Button> : null}
            </nav>
          </div>
        </div>
        <p className="archive-trust-note"><Info aria-hidden="true" /> 置信度衡量来源的证据强度，不是对公司的评价；来源引用按事件计数，同一原文可能在不同事件中重复引用。</p>
      </section>
    </div>
  );
}

function FilterBar({ filters, options }: { filters: PublicFilters; options: Awaited<ReturnType<typeof getPublicFilterOptions>> }) {
  return (
    <>
      <form id="archive-filters" action="/impact" method="get" className="archive-filter-form">
        <div className="archive-filter-main">
          <Field label="搜索公司" htmlFor="f-q"><div className="archive-search"><Search aria-hidden="true" /><Input id="f-q" name="q" defaultValue={filters.q} placeholder="公司名称、中文名或别名…" maxLength={80} /></div></Field>
          <Field label="年份" htmlFor="f-year"><Select id="f-year" name="year" defaultValue={filters.year ?? ""}><option value="">全部年份</option>{options.years.map(({ value, count }) => <option key={value} value={value}>{value}（{count}）</option>)}</Select></Field>
          <Field label="行业" htmlFor="f-industry"><Select id="f-industry" name="industry" defaultValue={filters.industry ?? ""}><option value="">全部行业</option>{options.industries.map(({ value, count }) => <option key={value} value={value}>{labelOf(INDUSTRY, value)}（{count}）</option>)}</Select></Field>
          <Button type="submit">应用筛选</Button>
          {hasActiveFilters(filters) || filters.sort !== "date_desc" ? <Button asChild variant="ghost"><Link href="/impact">清除</Link></Button> : null}
        </div>
        <details className="archive-more-filters" open={Boolean(filters.country || filters.confidence || filters.impactType)}>
          <summary><SlidersHorizontal aria-hidden="true" /> 更多筛选</summary>
          <div>
            <Field label="国家 / 地区" htmlFor="f-country"><Select id="f-country" name="country" defaultValue={filters.country ?? ""}><option value="">全部地区</option>{options.countries.map(({ value, count }) => <option key={value} value={value}>{countryLabel(value)}（{count}）</option>)}</Select></Field>
            <Field label="影响类型" htmlFor="f-impact"><Select id="f-impact" name="impactType" defaultValue={filters.impactType ?? ""}><option value="">全部类型</option>{optionsOf(IMPACT_TYPE).map(({ value, label }) => <option key={value} value={value}>{label}（{options.impactTypes.get(value) ?? 0}）</option>)}</Select></Field>
            <Field label="归因置信度" htmlFor="f-confidence"><Select id="f-confidence" name="confidence" defaultValue={filters.confidence ?? ""}><option value="">全部置信度</option>{optionsOf(ATTRIBUTION_CONFIDENCE).map(({ value, label }) => <option key={value} value={value}>{label}（{options.confidences.get(value) ?? 0}）</option>)}</Select></Field>
          </div>
          <p>括号内为全部已发布记录中的条数。修改条件或排序后点击「应用筛选」；地址栏会保留筛选条件。</p>
        </details>
      </form>
      <nav className="archive-type-tabs" aria-label="按影响类型筛选">
        <Link href={publicListingHref(filters, { impactType: null, page: 1 })} aria-current={!filters.impactType ? "page" : undefined}>全部事件<span>{[...options.impactTypes.values()].reduce((sum, count) => sum + count, 0)}</span></Link>
        {optionsOf(IMPACT_TYPE).map(({ value, label }) => <Link key={value} href={publicListingHref(filters, { impactType: value, page: 1 })} aria-current={filters.impactType === value ? "page" : undefined}>{label}<span>{options.impactTypes.get(value) ?? 0}</span></Link>)}
      </nav>
    </>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return <div className="archive-field"><label htmlFor={htmlFor}>{label}</label>{children}</div>;
}
