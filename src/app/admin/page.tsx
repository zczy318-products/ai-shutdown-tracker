import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveDbTarget, describeDbTarget } from "@/db/config";

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">后台占位页</h1>
        <p className="text-muted-foreground">
          录入与审核界面在 T4 实现。本页只用于确认登录态生效。
        </p>
      </div>

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
