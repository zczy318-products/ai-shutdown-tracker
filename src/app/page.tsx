import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ATTRIBUTION_CONFIDENCE,
  IMPACT_TYPE,
  OUTCOME,
  countryLabel,
  labelOf,
} from "@/lib/enums";
import { getCurrentUser } from "@/lib/auth";
import { listPublishedRecords } from "@/lib/records/store";

/**
 * Placeholder public page. T5 owns the real listing, filters, company pages and
 * dashboard; what exists here is the minimum that proves the visibility rule:
 * it reads through `listPublishedRecords`, which filters on
 * `record_status = 'published'` inside the query, so a draft cannot reach this
 * page even if the page itself forgets to filter.
 *
 * Every row shows its source count and attribution grade, because the one thing
 * the public surface must never do is present a record as a finding without the
 * evidence and the grade attached to it.
 */

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [user, records] = await Promise.all([getCurrentUser(), listPublishedRecords()]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <div className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">AI Shutdown Tracker</h1>
        <p className="text-muted-foreground text-balance">
          追踪 AI 对公司与岗位的影响记录。每一条记录都必须附带可核查的来源（链接 + 原文引述）
          与归因置信度评级。本平台不生产因果结论，只固定住公开报道里别人说过的话，并标注证据有多硬。
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">已发布记录（{records.length}）</h2>
        {records.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
            还没有已发布的记录。种子数据由 T4 录入，公开列表与仪表盘由 T5 实现。
          </p>
        ) : (
          <div className="divide-y rounded-lg border">
            {records.map(({ impact, company, sources }) => (
              <article key={impact.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">
                    {company.nameZh ? `${company.name}（${company.nameZh}）` : company.name}
                  </h3>
                  <Badge variant="outline">{countryLabel(company.countryCode)}</Badge>
                  <Badge variant="secondary">{labelOf(OUTCOME, impact.outcome)}</Badge>
                  <Badge variant="outline">
                    归因{labelOf(ATTRIBUTION_CONFIDENCE, impact.attributionConfidence)}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-sm">{impact.summary}</p>
                <p className="text-muted-foreground font-mono text-xs">
                  {impact.eventDate} · {labelOf(IMPACT_TYPE, impact.impactType)} ·{" "}
                  {sources.length} 条来源
                </p>
                {impact.counterEvidence ? (
                  <p className="text-muted-foreground text-xs">
                    反方证据：{impact.counterEvidence}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>当前状态</CardTitle>
          <CardDescription>
            T3 已落地数据模型与后台录入 / 审核。公开列表、筛选、公司详情与仪表盘在 T5 实现。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {user ? (
            <>
              <Button asChild>
                <Link href="/admin">进入后台</Link>
              </Button>
              <p className="text-muted-foreground self-center text-sm">已登录：{user.email}</p>
            </>
          ) : (
            <>
              <Button asChild>
                <Link href="/login">登录</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/register">注册</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
