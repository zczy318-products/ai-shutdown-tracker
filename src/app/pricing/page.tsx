import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { describeBilling, missingPriceIdErrorZh } from "@/lib/billing/config";
import { PLAN, TIER_COLUMNS, TIER_MATRIX, type Plan } from "@/lib/plans";
import {
  ANNUAL_DISCOUNT_LABEL_ZH,
  ANNUAL_EFFECTIVE_MONTHLY_LABEL,
  ANNUAL_PRICE_LABEL,
  ANNUAL_SAVING_LABEL,
  ANNUAL_SAVING_MONTHS_LABEL,
  BILLING_INTERVAL,
  BILLING_INTERVAL_VALUES,
  DEFAULT_BILLING_INTERVAL,
  MONTHLY_PRICE_LABEL,
  MONTHS_PER_YEAR,
  isBillingInterval,
  type BillingInterval,
} from "@/lib/pricing";

import { UpgradeButton } from "./upgrade-button";

/**
 * The pricing page — public, and public in the strong sense: it renders the
 * same for a visitor with no cookie as for a signed-in account, except for the
 * call to action.
 *
 * The thing this page has to get right is not the layout, it is the honesty.
 * ZCZ-7 §0 forbids implying that an account is needed to read anything, so the
 * comparison table leads with an "匿名访客" column that is already ticked for
 * every reading feature, and the page says so again in words above it. If a
 * later edit makes this page look like a paywall, the edit is wrong.
 *
 * ZCZ-14 added a second billing interval, and three rules came with it:
 *
 *  - **both prices are visible at once**, with no interaction. The monthly
 *    price, the annual total, the effective monthly price and the saving are
 *    all in the server-rendered body of an anonymous `GET /pricing`. A visitor
 *    should not have to click to find out what the other cycle costs.
 *  - **the choice lives in the URL** (`?interval=annual`), not in component
 *    state. Same decision as the listing's `?view=`: it renders on the server,
 *    works without JavaScript, survives a share, and has no hydration flash.
 *  - **no promise we cannot keep.** No refunds, no proration, no switching
 *    cycle mid-term, no "cancel any time and we'll pay you back" — none of
 *    that is implemented, so none of it is written here.
 *
 * Every number comes from `src/lib/pricing.ts`. Do not type a price into this
 * file.
 */

export const dynamic = "force-dynamic";

const EXPORT_PATH = "/api/export/records";

type RawSearchParams = Record<string, string | string[] | undefined>;
type SearchParams = Promise<RawSearchParams>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The same URL with a different `interval`, every other parameter kept.
 *
 * Kept means kept: `?reason=upgrade&from=account` has to survive the switch, or
 * flipping to annual would silently drop the banner explaining why the visitor
 * is on this page. Repeated keys are preserved too, which is why this appends
 * rather than assigning.
 */
function hrefWithInterval(params: RawSearchParams, interval: BillingInterval): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "interval" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
  }
  search.append("interval", interval);
  return `/pricing?${search.toString()}`;
}

/**
 * The billing-cycle chooser: two links, not a toggle.
 *
 * Links because the state is the URL. Styling is deliberately colourless —
 * border weight and background, no green "best value" flag — both because the
 * project's design rules keep semantic colour for things that actually have a
 * status, and because «8 折 / 折合 US$7.92 / 省 US$23.76» already makes the
 * case in numbers. `aria-current` is what tells a screen reader which one is
 * active; the border alone would not.
 */
function IntervalChoice({
  params,
  selected,
}: {
  params: RawSearchParams;
  selected: BillingInterval;
}) {
  return (
    <div role="group" aria-label="计费周期" className="flex flex-wrap gap-2">
      {BILLING_INTERVAL_VALUES.map((value) => {
        const active = value === selected;
        return (
          <Link
            key={value}
            href={hrefWithInterval(params, value)}
            aria-current={active ? "true" : undefined}
            className={[
              // min-h-11 keeps this well clear of the 24px floor in
              // `npm run verify:a11y` (WCAG 2.2 §2.5.8) at phone widths.
              "flex min-h-11 flex-col justify-center rounded-md border px-4 py-2 text-sm transition-colors",
              active
                ? "border-foreground bg-foreground/5 font-medium"
                : "border-border text-muted-foreground hover:bg-muted",
            ].join(" ")}
          >
            <span>
              {BILLING_INTERVAL[value].zh}
              {value === "annual" ? ` · ${ANNUAL_DISCOUNT_LABEL_ZH}` : null}
            </span>
            <span className="text-xs">{BILLING_INTERVAL[value].priceLabel}</span>
          </Link>
        );
      })}
    </div>
  );
}

/** Why the visitor landed here, when they arrived by being turned away. */
function Notice({ reason, checkout }: { reason?: string; checkout?: string }) {
  if (checkout === "cancelled") {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        已取消结账，账号没有任何变化。网站上的全部内容你仍然可以照常浏览。
      </div>
    );
  }

  if (reason === "anonymous") {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <p className="font-medium">你点的是「全量 CSV 导出」，它需要一个专业版账号。</p>
        <p className="text-muted-foreground mt-2">
          但请注意：榜单、搜索、全部筛选、详情页里的<strong>每一条</strong>来源链接与原文引述、
          以及统计仪表盘，都不需要账号也能看，也不会被截断或打码。
          导出只是把整个数据集一次性拿走的快捷方式。
        </p>
      </div>
    );
  }

  if (reason === "upgrade") {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <p className="font-medium">你的账号是免费档，全量 CSV 导出属于专业版。</p>
        <p className="text-muted-foreground mt-2">
          升级后，同一个链接会直接返回完整数据集（含来源 URL 与原文引述）。
          在此之前，站内的内容你一条都不少地能看到。
        </p>
      </div>
    );
  }

  return null;
}

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <span className="text-emerald-600 dark:text-emerald-400">✓</span>;
  if (value === false) return <span className="text-muted-foreground">—</span>;
  return <span className="text-muted-foreground text-xs">{value}</span>;
}

export default async function PricingPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const plan = (user?.plan ?? null) as Plan | null;
  const billing = describeBilling();

  // An unknown `?interval=` falls back to monthly *for display only*. That is
  // not the silent fallback `startUpgrade` forbids: here it picks which of two
  // visible prices is emphasised, and the button carries the interval it
  // actually resolved to. Nothing is charged on a GET.
  const rawInterval = first(params.interval);
  const interval: BillingInterval = isBillingInterval(rawInterval)
    ? rawInterval
    : DEFAULT_BILLING_INTERVAL;

  // `stripe_test` with only one price id configured: that one cycle cannot be
  // checked out, and says so where its button would be. The other is untouched.
  const priceIdMissing =
    billing.ok && billing.config.mode === "stripe_test" && !billing.config.priceIds[interval];

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">定价</h1>
        <p className="text-muted-foreground text-balance">
          <strong>浏览全部内容不需要账号。</strong>
          榜单、筛选、每条记录的全部来源与原文引述、统计仪表盘 —— 匿名访客就能完整看到，
          没有试读截断，没有模糊遮挡，也不会弹登录框。
          付费买的是「把整个数据集拿走」和「接进自己的系统」，不是阅读权限。
        </p>
        <p className="text-muted-foreground text-sm">
          全站只有一个付费档：<strong>{PLAN.pro.zh}</strong>，以美元计价，
          两种计费周期任选 ——{" "}
          <strong>
            按月 {MONTHLY_PRICE_LABEL}，或按年 {ANNUAL_PRICE_LABEL}
          </strong>
          （{ANNUAL_DISCOUNT_LABEL_ZH}，折合 {ANNUAL_EFFECTIVE_MONTHLY_LABEL}，比按月付满{" "}
          {MONTHS_PER_YEAR} 个月省 {ANNUAL_SAVING_LABEL}）。
          两种周期解锁的功能<strong>完全一样</strong>，年付不会多给任何权限。
          免费账号不收费，也不是第二个价位。
        </p>
      </div>

      <Notice reason={first(params.reason)} checkout={first(params.checkout)} />

      {/* --- 对照表 ------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>四种身份能做什么</CardTitle>
          <CardDescription>
            前三行对所有人开放，包括没有账号的访客。
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left font-medium">功能</th>
                {TIER_COLUMNS.map((column) => (
                  <th key={column.key} className="px-3 py-2 text-center font-medium">
                    <div>{column.zh}</div>
                    <div className="text-muted-foreground text-xs font-normal">
                      {column.noteZh}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIER_MATRIX.map((row) => (
                <tr key={row.featureZh} className="border-b last:border-0">
                  <td className="py-3 pr-3">
                    <div>{row.featureZh}</div>
                    {row.detailZh ? (
                      <div className="text-muted-foreground text-xs">{row.detailZh}</div>
                    ) : null}
                  </td>
                  {TIER_COLUMNS.map((column) => (
                    <td key={column.key} className="px-3 py-3 text-center">
                      <Cell value={row.values[column.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* --- 两张卡片 ----------------------------------------------------- */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{PLAN.free.zh}</CardTitle>
              {plan === "free" ? <Badge variant="secondary">当前套餐</Badge> : null}
            </div>
            <CardDescription>{PLAN.free.priceLabel}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">{PLAN.free.taglineZh}</p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5">
              <li>站内全部内容（和匿名访客完全一致）</li>
              <li>一个用于订阅与开票的账号</li>
            </ul>
            {user ? (
              <Button asChild variant="outline" className="w-full">
                <Link href="/account">账户设置</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/register?from=pricing">注册免费账号</Link>
                </Button>
                <p className="text-muted-foreground text-xs">
                  只想看数据的话，不用注册 —— 直接{" "}
                  <Link href="/" className="text-foreground underline underline-offset-4">
                    回到榜单
                  </Link>
                  。
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/*
          One pro card, two billing cycles — not two pro cards. The tier
          comparison above still has exactly four columns, because a billing
          cycle is not a fifth kind of visitor.
        */}
        <Card className="border-foreground/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{PLAN.pro.zh}</CardTitle>
              {plan === "pro" ? <Badge>当前套餐</Badge> : null}
            </div>
            <CardDescription>
              <span className="text-foreground text-xl font-semibold">
                {BILLING_INTERVAL[interval].priceLabel}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <IntervalChoice params={params} selected={interval} />

            {/*
              Shown for both selections, so the annual arithmetic is on the page
              for an anonymous visitor who never touches the chooser. All four
              numbers are derived in src/lib/pricing.ts from 990 分 and 4/5.
            */}
            <p className="text-muted-foreground text-xs">
              年付 {ANNUAL_PRICE_LABEL}：{ANNUAL_DISCOUNT_LABEL_ZH}，折合{" "}
              {ANNUAL_EFFECTIVE_MONTHLY_LABEL}，比按月付满 {MONTHS_PER_YEAR} 个月省{" "}
              {ANNUAL_SAVING_LABEL}（相当于 {ANNUAL_SAVING_MONTHS_LABEL}的月付费用）。
              年付按年计费，一次支付 {MONTHS_PER_YEAR} 个月。
            </p>

            <p className="text-muted-foreground">{PLAN.pro.taglineZh}</p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5">
              <li>免费档的全部内容</li>
              <li>全量 CSV 导出：一行一条来源，含来源 URL、媒体、发布日期与原文引述</li>
              <li>API key（可生成、可吊销）与只读查询接口 <code>GET /api/v1/records</code></li>
              <li>按月与按年解锁的功能完全一致：计费周期不影响任何权限、配额或导出范围</li>
            </ul>

            {plan === "pro" ? (
              <Button asChild className="w-full">
                <Link href="/account">去账户页导出 / 管理 key</Link>
              </Button>
            ) : !billing.ok ? (
              <p
                role="alert"
                className="border-destructive/50 bg-destructive/10 rounded-md border p-3 text-sm"
              >
                {billing.errorZh}
              </p>
            ) : priceIdMissing ? (
              <p
                role="alert"
                className="border-destructive/50 bg-destructive/10 rounded-md border p-3 text-sm"
              >
                {missingPriceIdErrorZh(interval)}
              </p>
            ) : (
              <UpgradeButton
                mode={billing.config.mode}
                interval={interval}
                label={`${
                  billing.config.mode === "stripe_test"
                    ? "用 Stripe 测试模式结账"
                    : user
                      ? "模拟升级为专业版"
                      : "注册并升级"
                }（${BILLING_INTERVAL[interval].zh}）`}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* --- 计费模式的实话 ------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>关于付款，把话说在前面</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>
            本项目<strong>不接真实收款</strong>。Stripe 只会以测试模式接入，
            不会配置 live key，任何按钮都不会从你的卡里扣到钱。
          </p>
          <p>当前运行模式：{billing.ok ? billing.config.reasonZh : billing.errorZh}</p>
          {billing.ok && billing.config.mode === "simulated" ? (
            <p>
              也就是说，「升级」按钮会直接把账号标记为专业版，用于演示导出与 API key
              这条链路。账户页会把这次升级标注为「本地模拟升级」，不会被当成一笔收入。
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href="/">返回榜单</Link>
        </Button>
        {/*
          Plain <a>: this hits a route handler that answers with a file
          download, which next/link's client navigation does not handle. For an
          anonymous or free visitor it 303s straight back here with the banner
          above — that path is the point of the link, not a bug.
        */}
        <Button asChild variant="ghost">
          <a href={EXPORT_PATH}>试一下全量 CSV 导出</a>
        </Button>
      </div>
    </main>
  );
}
