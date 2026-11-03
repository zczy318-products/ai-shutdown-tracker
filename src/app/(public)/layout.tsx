import Link from "next/link";

import { getCurrentUser } from "@/lib/auth";

/**
 * Chrome for the three public routes (`/`, `/company/[slug]`, `/stats`).
 *
 * The disclaimer in the footer is on **every** public page, not just the
 * dashboard: the ZCZ-1 plan requires the site to say out loud that these are
 * hand-made annotations of public reporting rather than findings of its own,
 * and that sentence is worth as little as the page it is missing from.
 *
 * Reading the session here makes the layout dynamic, which is what we want
 * anyway — see the `force-dynamic` note in each page.
 */

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-background/90 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Rest In Prompts
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              记录榜单
            </Link>
            <Link href="/stats" className="text-muted-foreground hover:text-foreground">
              统计仪表盘
            </Link>
          </nav>
          <div className="text-muted-foreground ml-auto flex items-center gap-3 text-xs">
            {user ? (
              <>
                <span className="font-mono">{user.email}</span>
                <Link href="/admin" className="hover:text-foreground underline">
                  进入后台
                </Link>
              </>
            ) : (
              <Link href="/login" className="hover:text-foreground underline">
                编辑登录
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>


      <footer className="mt-8 border-t">
        <div className="text-muted-foreground mx-auto max-w-6xl space-y-2 px-6 py-8 text-xs">
          <p>
            本站所有数据来自<strong className="font-medium">公开报道的人工标注</strong>
            ，每条记录都必须附带可核查的来源（原文链接 + 逐字引述）与归因置信度评级。
            页面只转述来源说过的话，<strong className="font-medium">不构成对任何公司的结论</strong>
            ，也不做模型推断的因果归因。
          </p>
          <p>
            置信度分档衡量的是<span className="font-medium">证据强度</span>
            ，不是对公司的评价；标为「已撤回 / 回退」的记录表示该事件后来被推翻，请以来源原文为准。
          </p>
        </div>
      </footer>
    </div>
  );
}
