import Link from "next/link";
import { ArrowRight, Building2, Database, ExternalLink, Info, Search, Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { shutdownCompanies } from "@/lib/shutdowns";

export const dynamic = "force-dynamic";

export default async function ShutdownListing({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const q = (first(params.q) ?? "").trim().slice(0, 80);
  const sort = ["name_asc", "name_desc"].includes(first(params.sort) ?? "") ? first(params.sort)! : "research";
  const needle = q.toLocaleLowerCase();
  const companies = shutdownCompanies.filter((company) => `${company.name} ${company.businessZh} ${company.id}`.toLocaleLowerCase().includes(needle));
  if (sort !== "research") companies.sort((a, b) => a.name.localeCompare(b.name, "en") * (sort === "name_desc" ? -1 : 1));
  const sources = shutdownCompanies.reduce((sum, company) => sum + company.sources.length, 0);

  return (
    <div className="archive-workspace">
      <section className="workspace-heading" aria-labelledby="archive-title">
        <div>
          <p className="workspace-eyebrow"><Database aria-hidden="true" /> COMPANY SHUTDOWN ARCHIVE</p>
          <h1 id="archive-title">已经停止运营的公司</h1>
          <p className="workspace-description">有证据的公司关闭记录。核对发生了什么，也分清它与 AI 的关系。</p>
        </div>
        <details className="archive-method">
          <summary><Info aria-hidden="true" /> 收录标准</summary>
          <div>
            <p>只收录有整体停止运营证据的 AI 相关公司。裁员、转型、单一产品停服或仍经营中的破产申请，不单独构成收录依据。</p>
            <p>公司整体停运不等于法律注销；资产、技术或员工可能转移至其他公司。公告日期与实际停运日期分开记录，未知日期不推算。</p>
            <p>这批资料确认的是历史关闭事实，尚未确立 AI 竞争或替代导致关闭的因果关系。它不是所有倒闭公司的完整统计。</p>
          </div>
        </details>
      </section>
      <section className="archive-metrics" aria-label="停运公司资料概览">
        <div className="archive-metric"><span className="metric-icon"><Building2 aria-hidden="true" /></span><div><p>整体停运公司</p><strong data-shutdown-count={shutdownCompanies.length}>{shutdownCompanies.length}</strong><span className="metric-unit">家</span></div><span className="metric-note">历史案例</span></div>
        <div className="archive-metric"><span className="metric-icon"><ExternalLink aria-hidden="true" /></span><div><p>公开来源</p><strong>{sources}</strong><span className="metric-unit">份</span></div><span className="metric-note">逐条可查阅</span></div>
        <div className="archive-metric"><span className="metric-icon"><Info aria-hidden="true" /></span><div><p>AI 导致关闭</p><strong>未确立</strong></div><span className="metric-note">单独判断因果</span></div>
        <div className="archive-metric"><span className="metric-icon"><Database aria-hidden="true" /></span><div><p>资料核查日期</p><strong className="shutdown-check-date">2026-11-04</strong></div><span className="metric-note">非关闭日期</span></div>
      </section>
      <section id="records" className="archive-records" data-result-total={companies.length} aria-labelledby="records-title">
        <div className="archive-section-heading"><h2 id="records-title">{q ? "筛选结果" : "停运公司名单"}<span>{companies.length}</span></h2><span className="archive-view-label"><Table2 aria-hidden="true" /> 表格视图</span></div>
        <div className="archive-panel">
          <form action="/" method="get" className="archive-filter-form shutdown-filters">
            <div className="archive-filter-main">
              <div className="archive-field"><label htmlFor="f-q">搜索公司</label><div className="archive-search"><Search aria-hidden="true" /><Input id="f-q" name="q" defaultValue={q} placeholder="公司名称或业务…" maxLength={80} /></div></div>
              <div className="archive-field"><label htmlFor="f-sort">排序</label><Select id="f-sort" name="sort" defaultValue={sort}><option value="research">研究名单顺序</option><option value="name_asc">公司名称 A–Z</option><option value="name_desc">公司名称 Z–A</option></Select></div>
              <Button type="submit">应用筛选</Button>
              {q || sort !== "research" ? <Button asChild variant="ghost"><Link href="/">清除</Link></Button> : null}
            </div>
          </form>
          <div className="archive-listing-toolbar"><p role="status">共 {companies.length} 家公司 · 每家公司一条档案</p><Link href="/impact">查看裁员、转型等影响事件 →</Link></div>
          <p className="archive-scroll-hint" id="archive-scroll-help"><span><ArrowRight aria-hidden="true" /> 横向滚动查看关闭事实与来源</span><span>公司列已固定</span></p>
          <div className="archive-table-scroll" role="region" aria-label="已停止运营公司表，可横向滚动" aria-describedby="archive-scroll-help" tabIndex={0}>
            <table className="archive-table shutdown-table">
              <caption className="sr-only">公司整体停止运营的历史记录；关闭事实和 AI 因果关系分别呈现。</caption>
              <colgroup><col className="col-company" /><col className="col-date" /><col className="col-impact" /><col className="col-summary" /><col className="col-confidence" /><col className="col-source" /></colgroup>
              <thead><tr><th scope="col" aria-sort={sort === "name_asc" ? "ascending" : sort === "name_desc" ? "descending" : "none"}>公司 / 业务</th><th scope="col">停运时间 / 确认节点</th><th scope="col">公司状态</th><th scope="col">关闭事实与后续</th><th scope="col">AI 导致关闭？</th><th scope="col">公开来源</th></tr></thead>
              <tbody>
                {companies.length === 0 ? <tr><td colSpan={6} className="archive-empty"><p>没有符合这些筛选条件的记录。</p><Link href="/">清除筛选，查看全部</Link></td></tr> : companies.map((company) => (
                  <tr key={company.id} data-shutdown-id={company.id}>
                    <th scope="row"><div className="archive-company"><span className="archive-monogram" aria-hidden="true">{company.name.charAt(0)}</span><div><Link className="archive-company-link" href={`/shutdown/${company.id}`}>{company.name}</Link><p>{company.businessZh}</p></div></div></th>
                    <td><span className="shutdown-date">{company.closureLabel}</span>{!company.closureDate ? <p className="shutdown-muted">实际停运日未知</p> : null}</td>
                    <td><span className="shutdown-status">公司整体停运</span></td>
                    <td><p className="archive-summary">{company.summaryZh}</p><Link className="archive-counter" href={`/shutdown/${company.id}#aftermath`}><Info aria-hidden="true" /> 后续去向与限定</Link></td>
                    <td><span className="shutdown-muted">因果关系未确立</span></td>
                    <td><Link className="archive-source-link" href={`/shutdown/${company.id}#sources`} aria-label={`查看 ${company.name} 的 ${company.sources.length} 份来源`}>{company.sources.length} 份来源<ExternalLink aria-hidden="true" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="archive-table-bottom"><p>历史案例 · 日期按证据精度展示 · 不等同于工商注销</p><span>已显示全部 {companies.length} 家</span></div>
        </div>
        <p className="archive-trust-note"><Info aria-hidden="true" /> AI 创业公司倒闭，不等于公司被 AI 淘汰。资产出售和团队转移的情况请查看每家公司的证据档案。</p>
      </section>
    </div>
  );
}
