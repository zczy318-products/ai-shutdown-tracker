import Link from "next/link";

import { Button } from "@/components/ui/button";
import { confirmSubscription } from "@/lib/subscribe/store";

/**
 * `GET /subscribe/confirm?token=…` — the second half of double opt-in.
 *
 * A GET that changes state, which is normally a smell. It is the right call
 * here: the alternative is making someone who clicked a link in their mail
 * client press a second button, and the people most likely to give up at that
 * step are the ones who were least sure in the first place. The trade-off is
 * that a mail client prefetching links can spend the token — the brief asks for
 * one-step confirmation, and `confirmSubscription` is idempotent-by-rejection,
 * so the worst case is a confirmed subscription and an "already used" page.
 *
 * No session is read and none is created. Confirming a subscription is not
 * logging in.
 */

export const dynamic = "force-dynamic";

export default async function ConfirmSubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const raw = Array.isArray(token) ? token[0] : token;
  const result = await confirmSubscription(raw ?? "");

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-16">
      {result.kind === "confirmed" ? (
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">订阅已确认</h1>
          <p className="text-muted-foreground text-sm">
            <span className="font-mono">{result.email}</span>{" "}
            已确认订阅，有新记录发布时会收到一封邮件。每封邮件底部都有一键退订链接。
          </p>
          <p className="text-muted-foreground text-sm">
            本站没有为你创建账号，也没有密码——我们只存了这个邮箱。
          </p>
        </div>
      ) : result.kind === "expired" ? (
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">确认链接已过期</h1>
          <p className="text-muted-foreground text-sm">
            确认链接的有效期是 7 天。重新在首页提交一次邮箱就会拿到新的链接。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">链接无效或已被使用</h1>
          <p className="text-muted-foreground text-sm">
            确认链接只能用一次。如果你之前已经确认过，订阅已经生效，不用再做什么；
            否则请回首页重新提交一次邮箱。
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
