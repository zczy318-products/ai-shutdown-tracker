import Link from "next/link";
import { FileText, Mail } from "lucide-react";

import { PublicNav } from "@/components/public/public-nav";
import { SubscribeForm } from "@/components/subscribe/subscribe-form";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";

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
              <><Link href="/account">账户</Link>{isAdmin(user) && <Link href="/admin">进入后台</Link>}</>
            ) : <Link href="/login" className="public-editor-login">编辑登录</Link>}
            <Link href="#public-subscribe" className="public-subscribe-link"><Mail aria-hidden="true" />登记订阅</Link>
          </div>
        </div>
      </header>
      <main id="public-main" className="public-container public-main">{children}</main>
      <div className="public-container public-subscribe" id="public-subscribe"><SubscribeForm /></div>
      <footer className="public-footer">
        <div className="public-container">
          <div className="public-footer-heading"><Link href="/" className="public-brand"><FileText aria-hidden="true" />Rest In Prompts</Link><Link href="/stats">查看影响事件统计 →</Link></div>
          <p>首页收录有公司整体停运证据的历史案例，并附公开来源与引述。公司关闭、法律注销和由 AI 导致关闭是不同事实；部分资产或产品可能在其他公司继续运营。</p>
          <p>影响事件与其统计单独呈现，包含裁员、转型等，不计入停运公司名单。资料由自动化工具辅助整理，不代表逐条人工核验；请以原文及后续公告为准。</p>
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
    console.error("[public] session read failed, rendering as anonymous:");
    return null;
  }
}
