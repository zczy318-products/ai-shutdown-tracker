import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveDbTarget, describeDbTarget } from "@/db/config";
import { RECORD_STATUS, RECORD_STATUS_VALUES, labelOf } from "@/lib/enums";
import { countByStatus } from "@/lib/records/store";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const counts = await countByStatus();
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">后台</h1>
        <p className="text-muted-foreground">
          录入、审核与发布 AI 影响记录。只有「已发布」的记录会出现在公开前台。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>记录</CardTitle>
          <CardDescription>共 {total} 条</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-5">
            {RECORD_STATUS_VALUES.map((status) => (
              <div key={status} className="rounded-md border p-3">
                <dt className="text-muted-foreground text-xs">
                  {labelOf(RECORD_STATUS, status)}
                </dt>
                <dd className="font-mono text-lg">{counts[status] ?? 0}</dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-3">
            <Button asChild>
              <Link href="/admin/records/new">+ 新建记录</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/records">记录列表</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/admin/records?status=in_review">待审核队列</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>运行环境</CardTitle>
          <CardDescription>当前进程实际连接的数据库驱动。</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">数据库</dt>
            <dd className="font-mono">{describeDbTarget(resolveDbTarget())}</dd>
            <dt className="text-muted-foreground">NODE_ENV</dt>
            <dd className="font-mono">{process.env.NODE_ENV}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
