import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getShutdownCompany } from "@/lib/shutdowns";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const company = getShutdownCompany((await params).slug);
  return { title: company ? `${company.name} · 停运档案 — Rest In Prompts` : "未找到停运档案", description: company?.summaryZh };
}

export default async function ShutdownDetail({ params }: { params: Promise<{ slug: string }> }) {
  const company = getShutdownCompany((await params).slug);
  if (!company) notFound();
  return (
    <article className="shutdown-detail">
      <nav aria-label="返回名单"><Link href="/">← 返回停运公司名单</Link></nav>
      <header><p className="workspace-eyebrow">COMPANY SHUTDOWN RECORD</p><h1>{company.name}</h1><p>{company.businessZh}</p><span className="shutdown-status">公司整体停止运营</span></header>
      <dl className="shutdown-facts">
        <div><dt>停运时间 / 确认节点</dt><dd>{company.closureLabel}</dd></div>
        <div><dt>关闭公告</dt><dd>{company.announcementLabel ?? "公告日期未知"}</dd></div>
        <div><dt>历史规模</dt><dd>{company.scaleZh}</dd></div>
        <div><dt>AI 导致关闭？</dt><dd>因果关系未确立</dd></div>
      </dl>
      <section><h2>关闭事实</h2><p>{company.summaryZh}</p><p className="shutdown-muted">实际停运日期、公告日期和后续确认时间分别记录。法律注销状态未核实。</p></section>
      <section><h2>关闭原因与 AI 关系</h2><p>{company.reasonZh}</p></section>
      <section id="aftermath"><h2>后续去向与限定</h2><p>{company.aftermathZh}</p><p className="shutdown-muted">这里记录原公司的历史停运，不代表其全部产品、资产或团队从此消失；未进行持续至今的完整工商状态核查。</p></section>
      <section id="sources"><h2>来源与原文引述 <span>({company.sources.length})</span></h2>
        <p className="shutdown-muted">资料核查于 2026-11-04。以下为短引述，请通过原文链接查看上下文；研究时可读取不代表来源始终可访问。</p>
        <ol className="shutdown-sources">{company.sources.map((source) => <li key={source.id}>
          <h3>{source.publisher}</h3><p className="shutdown-muted">{source.publishedAt ? `发布于 ${source.publishedAt}` : "发布日期未提供"} · {source.accessStatus}</p>
          <a href={source.url} target="_blank" rel="noopener noreferrer">{source.url}</a>
          {source.quotes.map((quote, index) => <blockquote lang="en" key={index}>{quote}</blockquote>)}
        </li>)}</ol>
      </section>
    </article>
  );
}
