import Link from "next/link";
import { FileText, Mail } from "lucide-react";

import { PublicNav } from "@/components/public/public-nav";
import { SubscribeForm } from "@/components/subscribe/subscribe-form";
import { getCurrentUser } from "@/lib/auth";

import "./public.css";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await readSessionQuietly();

  return (
    <div className="public-site">
      <a className="public-skip-link" href="#public-main">跳至主要内容</a>
      <header className="public-header">
        <div className="public-container public-header-inner">
          <Link href="/" className="public-brand"><FileText aria-hidden="true" />Rest In Prompts</Link>
          <PublicNav />
          <div className="public-header-actions">
            {user ? (
              <><Link href="/account">账户</Link><Link href="/admin">进入后台</Link></>
            ) : <Link href="/login" className="public-editor-login">编辑登录</Link>}
            <Link href="#public-subscribe" className="public-subscribe-link"><Mail aria-hidden="true" />登记订阅</Link>
          </div>
        </div>
      </header>
      <main id="public-main" className="public-container public-main">{children}</main>
      <div className="public-container public-subscribe" id="public-subscribe"><SubscribeForm /></div>
      <footer className="public-footer">
        <div className="public-container">
          <div className="public-footer-heading"><Link href="/" className="public-brand"><FileText aria-hidden="true" />Rest In Prompts</Link><Link href="/stats">查看统计仪表盘 →</Link></div>
          <p>本站数据来自公开报道的收集与整理，记录可能由自动化流程生成，并非每条均经人工核验。每条记录附可核查的原文链接、逐字引述与归因置信度；页面只转述来源说过的话，不构成对任何公司的结论，也不做模型推断的因果归因。</p>
          <p>置信度衡量的是证据强度，不是对公司的评价；标为「已撤回 / 回退」的记录表示事件后来出现更正，请以来源原文为准。</p>
        </div>
      </footer>
    </div>
  );
}

// Session failure only changes navigation; record-query failures retain their own error state.
async function readSessionQuietly() {
  try {
    return await getCurrentUser();
  } catch (error) {
    console.error("[public] session read failed, rendering as anonymous:", error);
    return null;
  }
}
