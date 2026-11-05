import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { SUBSCRIBER_STATUS, SUBSCRIBER_STATUS_VALUES, labelOf, type SubscriberStatus } from "@/lib/enums";
import { getMailer } from "@/lib/mailer";
import { countSubscribersByStatus, listRecentSubscribers } from "@/lib/subscribe/store";

/**
 * Read-only view of the collected subscriptions.
 *
 * It exists because the product decision for T10 was "collect now, send later":
 * without a page, the signups are rows nobody can see, and the only value of
 * that decision is that the rows are there to be used later. So this page
 * answers two questions — how many are there, and are they real.
 *
 * It is read-only in the strict sense: no form, no server action, nothing that
 * writes. In particular there is **no "mark as confirmed" button**. Every row
 * here will sit at «待确认» until a mail provider is wired up and the person
 * clicks a link, and that is the correct state, not a queue to be cleared by
 * hand. Confirming on someone's behalf would record a consent they never gave,
 * and would put them on the first real send.
 *
 * Addresses are shown in full. This is behind the `/admin` session gate, and a
 * masked list could not answer "are these real signups or junk", which is the
 * question an operator actually has.
 */

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<SubscriberStatus, "warning" | "success" | "secondary"> = {
  pending: "warning",
  confirmed: "success",
  unsubscribed: "secondary",
};

const STATUS_NOTE: Record<SubscriberStatus, string> = {
  pending: "已登记，等待本人点确认链接",
  confirmed: "本人点过确认链接，可发信",
  unsubscribed: "已退订，任何发信查询都不会选中",
};

const LIST_LIMIT = 200;

/** `2026-11-03 14:20`, in the server's zone. Dense, sortable, no ambiguity. */
function formatTimestamp(value: Date | null): string {
  if (!value) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
    ` ${pad(value.getHours())}:${pad(value.getMinutes())}`
  );
}

export default async function SubscribersPage() {
  // Before any read, not only in the layout: see `requireAdmin`. A layout that
  // redirects still lets this page's queries run, and subscriber addresses are
  // the last thing that should be rendered into a response that is on its way
  // to someone being turned away.
  await requireAdmin();

  const [counts, rows] = await Promise.all([
    countSubscribersByStatus(),
    listRecentSubscribers(LIST_LIMIT),
  ]);
  const total = SUBSCRIBER_STATUS_VALUES.reduce((sum, status) => sum + counts[status], 0);
  const mailer = getMailer();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">订阅者</h1>
        <p className="text-muted-foreground text-sm">
          只读视图。订阅不走账号系统：订阅者只留了一个邮箱，没有密码、没有用户记录，也不会登录。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>发信状态</CardTitle>
          <CardDescription>当前这套部署实际的发信能力。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {mailer.canDeliver ? (
            <p>
              邮件服务已接通（驱动 <span className="font-mono">{mailer.driver}</span>）。确认邮件会真实发出。
            </p>
          ) : (
            <>
              <p>
                还没有接通邮件服务，当前是 <span className="font-mono">log</span>{" "}
                驱动：邮件不会送出，日志默认隐藏邮箱和确认链接。
              </p>
              <p className="text-muted-foreground">
                所以订阅会长期停在「待确认」——这是预期结果，不是故障。「已确认」的含义是本人点过邮件里的链接；没发过邮件就没人点过，
                因此本页不提供「手动确认」操作，也没有「无邮件服务时自动确认」的开关。接通后这些待确认的邮箱仍然需要各自点一次确认链接。
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>订阅分布</CardTitle>
          <CardDescription>共 {total} 个邮箱</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            {SUBSCRIBER_STATUS_VALUES.map((status) => (
              <div key={status} className="rounded-md border p-3">
                <dt className="text-muted-foreground text-xs">
                  {labelOf(SUBSCRIBER_STATUS, status)}
                </dt>
                <dd className="font-mono text-lg">{counts[status]}</dd>
                <dd className="text-muted-foreground mt-1 text-xs">{STATUS_NOTE[status]}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
          还没有人订阅。公开页面底部的订阅表单是唯一的入口。
        </div>
      ) : (
        <div className="space-y-2">
          <div className="divide-y rounded-lg border">
            {rows.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{row.email}</span>
                <Badge variant={STATUS_VARIANT[row.status]}>
                  {labelOf(SUBSCRIBER_STATUS, row.status)}
                </Badge>
                <span className="text-muted-foreground font-mono text-xs">
                  来自 {row.source} · 登记 {formatTimestamp(row.createdAt)}
                  {row.confirmedAt ? ` · 确认 ${formatTimestamp(row.confirmedAt)}` : ""}
                  {row.unsubscribedAt ? ` · 退订 ${formatTimestamp(row.unsubscribedAt)}` : ""}
                </span>
              </div>
            ))}
          </div>
          {total > rows.length ? (
            <p className="text-muted-foreground text-xs">
              只列出最近 {LIST_LIMIT} 个（共 {total} 个）。上面的分布统计的是全部。
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
