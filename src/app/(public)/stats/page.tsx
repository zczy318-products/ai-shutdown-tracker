import Link from "next/link";

import { ChartCard, HorizontalBars, StatTable, YearColumns } from "@/components/charts/bars";
import { DataUnavailable } from "@/components/public/data-unavailable";
import { CONFIDENCE_BAR, IMPACT_TYPE_BAR } from "@/components/public/record-badges";
import {
  ATTRIBUTION_CONFIDENCE,
  IMPACT_TYPE,
  INDUSTRY,
  REGION,
  labelOf,
} from "@/lib/enums";
import { formatPercent } from "@/lib/format";
import {
  INDUSTRY_CHART_SLOTS,
  getPublicStats,
  loadPublic,
  type PublicStats,
} from "@/lib/records/public";
import { cn } from "@/lib/utils";

/**
 * The dashboard: four charts over the published set, plus the counting rules.
 *
 * Every number here is computed **at request time** from `published` rows only.
 * There is no build-time aggregation on purpose: a static query here would make
 * the first Vercel build fail before the user has set `DATABASE_URL`, and it
 * would also let the dashboard drift from the listing it is supposed to
 * summarise.
 *
 * No chart library — see the note in `src/components/charts/bars.tsx`. The
 * charts are server-rendered bars, so this route ships no client JavaScript and
 * the chart/table switch is a link rather than component state.
 *
 * The aggregation choices are stated on the page, not just in the code: 21
 * industries are folded to a top-8 plus «其他», and countries are counted by
 * the stored `region` (6 values) rather than by country, because a few dozen
 * records spread over ~250 countries is noise, not a distribution.
 */

export const dynamic = "force-dynamic";

type View = "chart" | "table";

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const view: View = (Array.isArray(params.view) ? params.view[0] : params.view) === "table"
    ? "table"
    : "chart";
  const result = await loadPublic(getPublicStats);
  if (!result.ok) {
    return <DataUnavailable retryHref={view === "table" ? "/stats?view=table" : "/stats"} />;
  }
  const stats = result.data;

  return (
    <div className="space-y-8">
      <header className="max-w-3xl space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">统计仪表盘</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          下面所有数字都<strong className="text-foreground font-medium">只统计已发布记录</strong>
          ，按<strong className="text-foreground font-medium">事件</strong>
          计数（同一家公司的两次事件算两条）。数据来自公开报道的人工标注，
          <strong className="text-foreground font-medium">不构成对任何公司的结论</strong>。
        </p>
      </header>

      {stats.records === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-12 text-center text-sm">
          <p>还没有已发布的记录，暂无可统计数据。</p>
          <Link href="/" className="mt-2 inline-block underline">
            返回记录榜单
          </Link>
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <Tile name="records" label="已发布记录" value={stats.records} unit="条" />
            <Tile name="companies" label="涉及公司" value={stats.companies} unit="家" />
            <Tile name="sources" label="引用来源" value={stats.sources} unit="条" />
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <ViewSwitch view={view} />
            <p className="text-muted-foreground text-xs">
              计数轴一律从 0 开始；柱 / 条上直接标注数值，不依赖颜色读数。
            </p>
          </div>

          {view === "chart" ? <Charts stats={stats} /> : <Tables stats={stats} />}

          <section className="text-muted-foreground max-w-3xl space-y-2 border-t pt-6 text-xs">
            <h2 className="text-foreground text-sm font-medium">统计口径</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                只统计 <code className="font-mono">record_status = published</code> 的记录；草稿、
                待审核、已拒收、已下架都不计入，所以这里的条数与榜单页一致。
              </li>
              <li>年度趋势按事件日期（<code className="font-mono">event_date</code>）的年份归档；中间没有记录的年份保留为空柱，不做压缩。</li>
              <li>
                行业有 21 个取值，图中只排前 {INDUSTRY_CHART_SLOTS} 名，其余合并为「其他」，
                合并条数在表格视图里可以逐项核对。
              </li>
              <li>
                国家约 250 个取值，按入库时已存储的地区（region，6 个取值）聚合；
                单个国家的条数见榜单页的国家筛选。
              </li>
              <li>
                归因置信度是按 ZCZ-2 归因标准<strong className="font-medium">人工评级</strong>
                的证据强度，不是模型推断，也不是对公司的评价。
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({
  name,
  label,
  value,
  unit,
}: {
  name: string;
  label: string;
  value: number;
  unit: string;
}) {
  return (
    // `data-stat-*`: see the note on `data-result-*` in the listing page.
    <div className="bg-card rounded-xl border p-5" data-stat-name={name} data-stat-value={value}>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-mono text-3xl tabular-nums">
        {value}
        <span className="text-muted-foreground ml-1 text-sm">{unit}</span>
      </p>
    </div>
  );
}

function ViewSwitch({ view }: { view: View }) {
  const tabs: { value: View; label: string; href: string }[] = [
    { value: "chart", label: "图表", href: "/stats" },
    { value: "table", label: "表格", href: "/stats?view=table" },
  ];
  return (
    <div className="inline-flex rounded-md border p-0.5 text-xs" role="group" aria-label="展示方式">
      {tabs.map((tab) => (
        <Link
          key={tab.value}
          href={tab.href}
          aria-current={view === tab.value ? "true" : undefined}
          className={cn(
            "rounded-[5px] px-3 py-1",
            view === tab.value
              ? "bg-secondary text-secondary-foreground font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Labels shared by both views, so a chart row and a table row cannot disagree
// ---------------------------------------------------------------------------

function industryLabel(key: PublicStats["byIndustry"][number]): string {
  return key.key === "__rest__"
    ? `其他（${key.folded} 个行业合计）`
    : labelOf(INDUSTRY, key.key);
}

function Charts({ stats }: { stats: PublicStats }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ChartCard title="年度趋势" note="每年已发布记录数（按事件日期的年份）">
        <YearColumns data={stats.byYear} />
      </ChartCard>

      <ChartCard
        title="影响类型占比"
        note={`四类固定取值，颜色与实体绑定、不随排名改变；共 ${stats.records} 条`}
        legend={
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {stats.byImpactType.map((row) => (
              <li key={row.key} className="text-muted-foreground flex items-center gap-1.5">
                <span
                  className={cn("size-2 rounded-full", IMPACT_TYPE_BAR[row.key])}
                  aria-hidden
                />
                {labelOf(IMPACT_TYPE, row.key)}
              </li>
            ))}
          </ul>
        }
      >
        <HorizontalBars
          total={stats.records}
          withPercent
          data={stats.byImpactType.map((row) => ({
            key: row.key,
            label: labelOf(IMPACT_TYPE, row.key),
            value: row.count,
            colorClass: IMPACT_TYPE_BAR[row.key],
          }))}
        />
      </ChartCard>

      <ChartCard
        title="行业分布"
        note={`前 ${INDUSTRY_CHART_SLOTS} 名按条数降序，其余合并为「其他」并固定排在末位`}
      >
        <HorizontalBars
          total={stats.records}
          data={stats.byIndustry.map((row) => ({
            key: row.key,
            label: industryLabel(row),
            value: row.count,
          }))}
        />
      </ChartCard>

      <ChartCard title="国家分布" note="按入库时已存储的地区（region）聚合，而不是逐个国家">
        <HorizontalBars
          total={stats.records}
          data={stats.byRegion.map((row) => ({
            key: row.key,
            label: labelOf(REGION, row.key),
            value: row.count,
          }))}
        />
      </ChartCard>

      <ChartCard
        title="归因置信度分布"
        note="有序分档，刻意不用彩色：色阶表示证据强度，不表示严重程度"
      >
        <HorizontalBars
          total={stats.records}
          withPercent
          data={stats.byConfidence.map((row) => ({
            key: row.key,
            label: `${labelOf(ATTRIBUTION_CONFIDENCE, row.key)} 置信度`,
            value: row.count,
            colorClass: CONFIDENCE_BAR[row.key],
          }))}
        />
      </ChartCard>
    </div>
  );
}

function Tables({ stats }: { stats: PublicStats }) {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <StatTable
        caption="年度趋势：每年已发布记录数"
        dimension="年份"
        total={stats.records}
        rows={stats.byYear.map((row) => ({
          key: String(row.key),
          label: `${row.key} 年`,
          value: row.count,
        }))}
      />
      <StatTable
        caption="影响类型占比"
        dimension="影响类型"
        total={stats.records}
        rows={stats.byImpactType.map((row) => ({
          key: row.key,
          label: labelOf(IMPACT_TYPE, row.key),
          value: row.count,
        }))}
      />
      <StatTable
        caption={`行业分布（前 ${INDUSTRY_CHART_SLOTS} 名 + 其他）`}
        dimension="行业"
        total={stats.records}
        rows={stats.byIndustry.map((row) => ({
          key: row.key,
          label: industryLabel(row),
          value: row.count,
        }))}
      />
      <StatTable
        caption="国家分布（按地区聚合）"
        dimension="地区"
        total={stats.records}
        rows={stats.byRegion.map((row) => ({
          key: row.key,
          label: labelOf(REGION, row.key),
          value: row.count,
        }))}
      />
      <StatTable
        caption="归因置信度分布"
        dimension="置信度"
        total={stats.records}
        rows={stats.byConfidence.map((row) => ({
          key: row.key,
          label: labelOf(ATTRIBUTION_CONFIDENCE, row.key),
          value: row.count,
        }))}
      />
      <p className="text-muted-foreground self-end text-xs">
        表格与图表读的是同一组查询结果，占比的分母一律是已发布记录总数（
        {stats.records} 条，{formatPercent(stats.records, stats.records)}）。
      </p>
    </div>
  );
}
