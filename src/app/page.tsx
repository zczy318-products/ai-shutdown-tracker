import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm font-medium">T2 脚手架</p>
        <h1 className="text-4xl font-semibold tracking-tight">AI Shutdown Tracker</h1>
        <p className="text-muted-foreground text-balance">
          追踪 AI 产品与项目的关停记录。每一条记录都必须附带可核查的来源（链接 + 原文引用）与归因置信度评级。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>当前状态</CardTitle>
          <CardDescription>
            数据模型将在 T3 按 ZCZ-2 数据字典落地；本阶段只验证应用骨架、数据库迁移与认证链路。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {user ? (
            <>
              <Button asChild>
                <Link href="/admin">进入后台</Link>
              </Button>
              <p className="text-muted-foreground self-center text-sm">
                已登录：{user.email}
              </p>
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
