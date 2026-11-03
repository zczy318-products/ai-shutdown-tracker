import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listApiKeys } from "@/lib/api-keys";
import { getCurrentUser } from "@/lib/auth";
import { describeBilling } from "@/lib/billing/config";
import { recentBillingEvents } from "@/lib/billing/store";
import { PLAN, PLAN_SOURCE, can, labelOfPlanSource, type Plan } from "@/lib/plans";
import { BILLING_INTERVAL, isBillingInterval, labelOfBillingInterval } from "@/lib/pricing";

import { DowngradeButton } from "../pricing/upgrade-button";
import { ApiKeysPanel, type KeyRow } from "./api-keys-panel";

/**
 * The signed-in account page: current plan, the export, and API keys.
 *
 * It is the only place a plan actually matters to a human, so it is also
 * where the honesty lives — a `simulated` or `stripe_test` upgrade is
 * labelled as such next to the plan badge, and the recent `billing_events`
 * are listed underneath. Nobody should be able to look at this page after a
 * demo and come away thinking money changed hands.
 */

export const dynamic = "force-dynamic";

const EXPORT_PATH = "/api/export/records";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatTime(value: Date | null): string | null {
  return value ? value.toISOString().replace("T", " ").slice(0, 16) + " UTC" : null;
}

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const plan = user.plan as Plan;
  // `can()` takes the plan and nothing else — an annual subscriber is not a
  // different tier from a monthly one (ZCZ-14 §2). The interval below is shown,
  // never consulted for a permission.
  const isPro = can(plan, "exportFullCsv");
  const intervalLabel = labelOfBillingInterval(user.planInterval);
  const intervalPriceLabel = isBillingInterval(user.planInterval)
    ? BILLING_INTERVAL[user.planInterval].priceLabel
    : null;
  const billing = describeBilling();

  const [keys, events] = await Promise.all([
    listApiKeys(user.id),
    recentBillingEvents(user.id),
  ]);

  const keyRows: KeyRow[] = keys.map((item) => ({
    id: item.id,
    name: item.name,
    tokenPrefix: item.tokenPrefix,
    createdAt: formatTime(item.createdAt) ?? "",
    lastUsedAt: formatTime(item.lastUsedAt),
    revokedAt: formatTime(item.revokedAt),
  }));

  const justUpgraded = first(params.upgraded) || first(params.checkout);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">账户</h1>
          <p className="text-muted-foreground text-sm">{user.email}</p>
          {/*
            The account's own uuid. Not a secret — it identifies the row the
            viewer is already looking at — and it is what a Stripe event's
            `client_reference_id` carries, so having it visible is what makes a
            billing problem diagnosable without database access.
          */}
          <p className="text-muted-foreground font-mono text-xs" data-user-id={user.id}>
            账号 ID {user.id}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/">榜单</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin">后台</Link>
          </Button>
        </div>
      </div>

      {justUpgraded === "simulated" ? (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          已通过<strong>本地模拟升级</strong>切换为专业版。这不是一笔真实交易，也没有任何扣款。
        </div>
      ) : justUpgraded === "success" ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          Stripe 测试结账已完成。套餐由 webhook 回写，如果下方仍显示免费档，
          说明 webhook 还没送达（或 <code>STRIPE_WEBHOOK_SECRET</code> 未配置）—— 稍等后刷新。
        </div>
      ) : null}

      {/* --- 套餐 --------------------------------------------------------- */}
      {/*
        `data-plan` / `data-plan-interval` mirror the two columns on the row, so
        what the database holds is checkable over plain HTTP — that is how
        `npm run verify:saas` asserts `plan_interval` is `monthly` on one chain,
        `annual` on the other and gone after a downgrade. Neither is a secret:
        it is the viewer's own plan, and the alternative is a verification that
        trusts the page's prose.
      */}
      <Card>
        <CardHeader>
          <div
            className="flex flex-wrap items-center gap-3"
            data-plan={plan}
            data-plan-interval={user.planInterval ?? ""}
          >
            <CardTitle>当前套餐</CardTitle>
            <Badge variant={isPro ? "default" : "secondary"}>
              {PLAN[plan].zh}
              {intervalLabel ? ` · ${intervalLabel}` : null}
            </Badge>
            {user.planSource ? (
              <Badge variant="outline">{labelOfPlanSource(user.planSource)}</Badge>
            ) : null}
          </div>
          <CardDescription>
            套餐只影响全量导出与 API key。站内的阅读内容对所有人一致，和账号无关。
            {intervalLabel ? (
              <>
                {" "}
                计费周期是 <strong>{intervalLabel}</strong>（{intervalPriceLabel}）——
                它只决定扣款频率，不影响任何权限：按月与按年能用的东西完全一样。
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {user.planSource === "simulated" ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              这个专业版是<strong>本地模拟升级</strong>的结果，用于在没有 Stripe
              账号的情况下演示完整链路。没有产生任何真实费用。
            </p>
          ) : user.planSource === "stripe_test" ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              这个套餐来自 Stripe <strong>测试模式</strong>的结账，不是真实付款。
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {isPro ? null : (
              <Button asChild>
                <Link href="/pricing">查看定价并升级</Link>
              </Button>
            )}
            {isPro && billing.ok && billing.config.mode === "simulated" ? (
              <DowngradeButton />
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link href="/pricing">定价页</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* --- 导出 --------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>全量 CSV 导出</CardTitle>
          <CardDescription>
            已发布的全部记录，一行一条来源，含来源 URL、媒体、发布日期、原文引述与归因置信度。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {isPro ? (
            <>
              {/* Plain <a>: a file download, not a client-side navigation. */}
              <Button asChild>
                <a href={EXPORT_PATH}>下载 CSV</a>
              </Button>
              <p className="text-muted-foreground text-xs">
                文件带 UTF-8 BOM，Excel 双击打开不会乱码。也可以带 API key 用 curl 取。
              </p>
            </>
          ) : (
            <div className="space-y-3 rounded-md border border-dashed p-4">
              <p className="font-medium">全量导出属于专业版。</p>
              <p className="text-muted-foreground">
                免费档不能一次性拿走整个数据集，但站内每一条记录、每一条来源和引述，
                你都能照常查看和复制 —— 导出只是省事，不是解锁。
              </p>
              <Button asChild size="sm">
                <Link href="/pricing?from=account&reason=upgrade">升级到专业版</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- API key ------------------------------------------------------ */}
      <ApiKeysPanel keys={keyRows} enabled={can(plan, "apiKeys")} />

      {/* --- 计费流水 ----------------------------------------------------- */}
      {events.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>套餐变更记录</CardTitle>
            <CardDescription>最近 {events.length} 条，含模拟升级。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y text-sm">
              {events.map((event) => (
                <div key={event.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2">
                  <span className="text-muted-foreground font-mono text-xs">
                    {formatTime(event.createdAt)}
                  </span>
                  <span className="font-medium">
                    → {event.planAfter ? PLAN[event.planAfter as Plan].zh : "—"}
                    {/*
                      Blank on the rows written before ZCZ-14, and on
                      downgrades. Not backfilled: see drizzle/0005.
                    */}
                    {labelOfBillingInterval(event.intervalAfter)
                      ? ` · ${labelOfBillingInterval(event.intervalAfter)}`
                      : null}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {PLAN_SOURCE[event.source].zh} · {event.type}
                  </span>
                  {event.note ? (
                    <span className="text-muted-foreground w-full text-xs">{event.note}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
