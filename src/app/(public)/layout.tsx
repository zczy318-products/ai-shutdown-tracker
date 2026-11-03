import Link from "next/link";

import { SubscribeForm } from "@/components/subscribe/subscribe-form";
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
 *
 * The session read is deliberately failure-tolerant, and that is **not** the
 * same concession the pages refuse to make. `error.tsx` cannot catch a throw
 * from the layout itself (a boundary only covers its children), so a database
 * hiccup here would skip the readable error state entirely and surface Next's
 * default error page. The session only decides whether the header shows «编辑
 * 登录» or «进入后台» — losing it costs a convenience link and states nothing
 * false about the data. A failed *record* query still propagates, because there
 * «读不到» must never be rendered as «没有».
 */

/**
 * Header links are one line of small text, which measured 16–20 CSS px tall —
 * under the 24×24 minimum in WCAG 2.2 §2.5.8, and these are the site's primary
 * navigation on a phone. The padding enlarges the hit area while the matching
 * negative margin keeps the header exactly as tall as before, so this buys the
 * tappable area without a visual redesign.
 */
const navLink =
  "text-muted-foreground hover:text-foreground -my-2 inline-flex items-center py-2";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await readSessionQuietly();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-background/90 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <Link href="/" className="font-semibold tracking-tight">
            Rest In Prompts
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/" className={navLink}>
              记录榜单
            </Link>
            <Link href="/stats" className={navLink}>
              统计仪表盘
            </Link>
            {/*
              T6. In the nav, not tucked into a footer — but note that nothing
              in the two links above is behind it. Pricing sells bulk export
              and an API key; reading this site needs no account at all.
            */}
            <Link href="/pricing" className={navLink}>
              定价
            </Link>
          </nav>
          <div className="text-muted-foreground ml-auto flex items-center gap-3 text-xs">
            {user ? (
              <>
                <span className="font-mono">{user.email}</span>
                <Link href="/account" className={`${navLink} underline`}>
                  账户
                </Link>
                <Link href="/admin" className={`${navLink} underline`}>
                  进入后台
                </Link>
              </>
            ) : (
              <Link href="/login" className={`${navLink} underline`}>
                编辑登录
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>

      {/*
        T10: the subscribe form sits here rather than inside each page, so it is
        in the same place on the listing, every company page and the dashboard.
        It is the only thing the site asks of a visitor — and it asks for an
        email, not an account.
      */}
      <div className="mx-auto w-full max-w-6xl px-6 pb-10">
        <SubscribeForm />
      </div>

      <footer className="mt-8 border-t">
        <div className="text-muted-foreground mx-auto max-w-6xl space-y-4 px-6 py-8 text-xs">
          {/*
            S2-1 / ZCZ-16. The two policy pages belong in the footer of every
            public page, and they are the one pair of links here that has to
            work for a visitor with no account: 《我们怎么判断一条记录》 is the
            standard the paragraph below claims we follow, and 《提出异议》 is
            the only channel a company named on this site has. A dispute page
            nobody can find is the same as not having one.

            `text-sm` rather than the `text-xs` of the surrounding disclaimer —
            at 12 px these two links measured under the 24 px minimum in WCAG
            2.2 §2.5.8, and the padding below buys back the hit area without
            making the footer taller.
          */}
          <nav aria-label="站点说明" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <Link href="/methodology" className={navLink}>
              我们怎么判断一条记录
            </Link>
            <Link href="/corrections" className={navLink}>
              提出异议或更正
            </Link>
          </nav>
          <div className="space-y-2">
            <p>
              本站所有数据来自<strong className="font-medium">公开报道的人工标注</strong>
              ，每条记录都必须附带可核查的来源（原文链接 + 逐字引述）与归因置信度评级。
              页面只转述来源说过的话，
              <strong className="font-medium">不构成对任何公司的结论</strong>
              ，也不做模型推断的因果归因。
            </p>
            <p>
              置信度分档衡量的是<span className="font-medium">证据强度</span>
              ，不是对公司的评价；标为「已撤回 / 回退」的记录表示该事件后来被推翻，请以来源原文为准。
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** See the note above: chrome, not content. */
async function readSessionQuietly() {
  try {
    return await getCurrentUser();
  } catch (error) {
    console.error("[public] session read failed, rendering as anonymous:", error);
    return null;
  }
}
