import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { DataUnavailable } from "@/components/public/data-unavailable";
import { AttributionBadge, ImpactTypeBadge, OutcomeBadge } from "@/components/public/record-badges";
import { Badge } from "@/components/ui/badge";
import {
  COMPANY_SIZE,
  INDUSTRY,
  LINK_HEALTH,
  REGION,
  SOURCE_TYPE,
  countryLabel,
  labelOf,
} from "@/lib/enums";
import {
  formatAffectedPct,
  formatEventDate,
  formatSourceDate,
  hostnameOf,
} from "@/lib/format";
import { getPublicCompany, loadPublic, type PublicEvent } from "@/lib/records/public";

/**
 * One company: its profile, its published events in a timeline, and every
 * source behind each event.
 *
 * Two things this page must never do, both of them explicit product
 * constraints rather than style preferences:
 *
 *  1. **It does not conclude anything.** Every causal statement on the page is
 *     either the editor's reported-speech `summary` («据 X 报道……») or a
 *     verbatim quote attributed to a named outlet. The page's own voice is
 *     limited to labels and counts.
 *  2. **It truncates no source.** The source list is the reason the record is
 *     publishable at all, so all of them are rendered, in full, with the quote
 *     visible without interaction — no «展开更多», no first-three-then-link.
 *
 * `counter_evidence` is rendered with the same weight as the summary, directly
 * under it. A dataset that only shows the attribution and hides the denial
 * would be a worse record of the reporting than one that shows both.
 */

export const dynamic = "force-dynamic";

/**
 * `cache` dedupes the lookup between `generateMetadata` and the page body —
 * including the failure case, since a rejected promise is cached too.
 */
const loadCompany = cache((slug: string) => loadPublic(() => getPublicCompany(slug)));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadCompany(slug);
  // `generateMetadata` runs *outside* the error boundary, so a throw here would
  // 500 the route before the page could render its own failure state.
  if (!result.ok) return { title: "Rest In Prompts" };
  if (!result.data) return { title: "未找到记录 — Rest In Prompts" };

  const { company, events } = result.data;
  return {
    title: `${company.name} — Rest In Prompts`,
    description: events[0]?.impact.summary.slice(0, 120),
  };
}

export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await loadCompany(slug);
  if (!result.ok) return <DataUnavailable retryHref={`/company/${slug}`} />;
  // No published event means there is nothing we are allowed to show. A shell
  // page would imply a record being withheld; 404 is the honest answer. Note
  // this is reached only on a *successful* read — a failed one never 404s,
  // because "we could not look" is not "it does not exist".
  if (!result.data) notFound();

  const { company, events } = result.data;
  const totalSources = events.reduce((sum, event) => sum + event.sources.length, 0);

  return (
    <article className="space-y-10">
      <nav className="text-muted-foreground text-xs">
        <Link href="/" className="hover:text-foreground underline">
          记录榜单
        </Link>
        <span className="mx-2">/</span>
        <span>{company.name}</span>
      </nav>

      <header className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {company.name}
            {company.nameZh && company.nameZh !== company.name ? (
              <span className="text-muted-foreground ml-2 text-xl font-normal">
                {company.nameZh}
              </span>
            ) : null}
          </h1>
          {company.description ? (
            <p className="text-muted-foreground max-w-3xl text-sm leading-relaxed">
              {company.description}
            </p>
          ) : null}
        </div>

        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="行业">{labelOf(INDUSTRY, company.industry)}</Fact>
          <Fact label="国家 / 地区">
            {countryLabel(company.countryCode)}
            <span className="text-muted-foreground ml-1 text-xs">
              （{labelOf(REGION, company.region)}）
            </span>
          </Fact>
          <Fact label="事件前规模">{labelOf(COMPANY_SIZE, company.companySize)}</Fact>
          <Fact label="成立年份">{company.foundedYear ?? "未记录"}</Fact>
          {company.aliases.length > 0 ? (
            <Fact label="别名 / 旧称" className="sm:col-span-2">
              {company.aliases.join("、")}
            </Fact>
          ) : null}
          {company.websiteUrl ? (
            <Fact label="官网">
              <a
                href={company.websiteUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline"
              >
                {hostnameOf(company.websiteUrl)}
              </a>
            </Fact>
          ) : null}
          <Fact label="已发布事件">
            {events.length} 个 · 共 {totalSources} 条来源
          </Fact>
        </dl>
      </header>

      <section className="space-y-8">
        <h2 className="text-lg font-medium">
          事件时间线
          <span className="text-muted-foreground ml-2 text-xs font-normal">
            按事件日期从新到旧；仅显示已发布记录
          </span>
        </h2>
        {events.map((event) => (
          <EventSection key={event.impact.id} event={event} />
        ))}
      </section>
    </article>
  );
}

function Fact({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function EventSection({ event }: { event: PublicEvent }) {
  const { impact, sources } = event;
  const affectedPct = formatAffectedPct(impact.employeesAffectedPct);

  return (
    <section className="bg-card space-y-5 rounded-xl border p-6" id={`event-${impact.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-sm tabular-nums">
          {formatEventDate(impact.eventDate, impact.eventDatePrecision)}
        </h3>
        <OutcomeBadge outcome={impact.outcome} />
        <ImpactTypeBadge impactType={impact.impactType} />
        <AttributionBadge confidence={impact.attributionConfidence} />
        {impact.isPrimary ? <Badge variant="outline">主事件</Badge> : null}
      </div>

      <div className="max-w-3xl space-y-4">
        <p className="text-sm leading-relaxed">{impact.summary}</p>

        {(impact.employeesAffected !== null || affectedPct || impact.revenueImpactNote) ? (
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            {impact.employeesAffected !== null ? (
              <Fact label="受影响人数">{impact.employeesAffected} 人</Fact>
            ) : null}
            {affectedPct ? <Fact label="占员工比例">{affectedPct}</Fact> : null}
            {impact.revenueImpactNote ? (
              <Fact label="营收影响" className="sm:col-span-3">
                {impact.revenueImpactNote}
              </Fact>
            ) : null}
          </dl>
        ) : null}

        {impact.counterEvidence ? (
          <div className="bg-muted/40 rounded-lg border p-4">
            <p className="text-xs font-medium">反方证据 / 其他归因说法</p>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              {impact.counterEvidence}
            </p>
          </div>
        ) : null}
      </div>

      <div
        className="space-y-4"
        id={`sources-${impact.id}`}
        data-impact-id={impact.id}
        data-source-count={sources.length}
      >
        <div className="flex flex-wrap items-baseline gap-2 border-t pt-4">
          <h4 className="text-sm font-medium">来源（{sources.length} 条，全部列出）</h4>
          <p className="text-muted-foreground text-xs">
            以下引述为来源原文逐字摘录，归属于各自媒体，不代表本站结论。
          </p>
        </div>
        <ol className="space-y-5">
          {sources.map((item, index) => (
            <li key={item.id} data-source-id={item.id} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  [{index + 1}]
                </span>
                <span className="font-medium">{item.mediaName}</span>
                <Badge variant="outline">{labelOf(SOURCE_TYPE, item.sourceType)}</Badge>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {formatSourceDate(item.publishedAt)}
                </span>
                {item.linkHealth !== "ok" ? (
                  <Badge
                    variant="outline"
                    title="链接状态由人工核对；原文可能需要换用归档链接访问"
                  >
                    链接状态：{labelOf(LINK_HEALTH, item.linkHealth)}
                  </Badge>
                ) : null}
              </div>

              {item.title ? <p className="text-sm">{item.title}</p> : null}

              {/*
                墓志铭区块（设计规范 §6）：窄栏、稍大字号的引文块，视觉上明确是
                「引述他人」而不是平台自己的论断。左对齐而非居中——引述多为英文长句，
                居中会显著降低可读性，这是对规范 §6 的一处有意偏离。
              */}
              <blockquote className="border-chart-axis max-w-prose border-l-2 pl-4">
                <p className="text-[15px] leading-relaxed">“{item.quote}”</p>
                <footer className="text-muted-foreground mt-2 text-xs">
                  —— {item.mediaName}
                  {item.author ? `，${item.author}` : ""}，
                  {formatSourceDate(item.publishedAt)}
                  {item.quoteLang !== "zh" ? `（原文，${item.quoteLang.toUpperCase()}）` : "（原文）"}
                </footer>
                {item.quoteTranslationZh ? (
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    <span className="mr-1 rounded border px-1 py-0.5 text-[11px]">中文译文</span>
                    {item.quoteTranslationZh}
                  </p>
                ) : null}
              </blockquote>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="underline"
                >
                  打开原文 · {hostnameOf(item.url)}
                </a>
                {item.archiveUrl ? (
                  <a
                    href={item.archiveUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-muted-foreground hover:text-foreground underline"
                  >
                    归档快照
                  </a>
                ) : null}
                {item.manuallyVerified ? (
                  <span className="text-muted-foreground">已人工打开核对</span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
