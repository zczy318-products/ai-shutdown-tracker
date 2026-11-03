import Link from "next/link";

import { Button } from "@/components/ui/button";
import { unsubscribeByToken } from "@/lib/subscribe/store";

/**
 * `GET /subscribe/unsubscribe?token=…` — one click, done.
 *
 * No login, no "manage your preferences" screen, no confirmation step. Opening
 * this URL has already unsubscribed you by the time the page renders, and a
 * second visit says the same thing rather than erroring: the link in an old
 * email has to keep working, and a link checker that fetched it first must not
 * leave the human with a failure page.
 *
 * Hiding an unsubscribe behind a login is how mailing lists become inescapable
 * for exactly the people who never signed up — so there is nothing here that
 * reads a session.
 */

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const raw = Array.isArray(token) ? token[0] : token;
  const result = await unsubscribeByToken(raw ?? "");

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-16">
      {result.kind === "unsubscribed" ? (
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">已退订</h1>
          <p className="text-muted-foreground text-sm">
            这个邮箱不会再收到本站的任何邮件。不需要确认，也不需要登录——现在就已经生效了。
          </p>
          <p className="text-muted-foreground text-sm">
            如果以后想再订阅，在首页重新提交一次邮箱即可（会再走一次确认）。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">退订链接无效</h1>
          <p className="text-muted-foreground text-sm">
            这个链接我们认不出来。请直接用邮件底部的退订链接；如果链接已经打不开，
            说明这个邮箱不在订阅列表里。
          </p>
        </div>
      )}

      <div>
        <Button asChild variant="outline">
          <Link href="/">返回首页</Link>
        </Button>
      </div>
    </main>
  );
}
