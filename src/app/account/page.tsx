import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listApiKeys } from "@/lib/api-keys";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/authorization";

import { logout } from "../(auth)/actions";
import { ApiKeysPanel, type KeyRow } from "./api-keys-panel";

export const dynamic = "force-dynamic";

function formatTime(value: Date | null): string | null {
  return value ? value.toISOString().replace("T", " ").slice(0, 16) + " UTC" : null;
}

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const keys = await listApiKeys(user.id);
  const keyRows: KeyRow[] = keys.map((item) => ({
    id: item.id, name: item.name, tokenPrefix: item.tokenPrefix,
    createdAt: formatTime(item.createdAt) ?? "", lastUsedAt: formatTime(item.lastUsedAt),
    revokedAt: formatTime(item.revokedAt),
  }));

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">账户</h1>
          <p className="text-muted-foreground text-sm">{user.email}</p>
          <p className="text-muted-foreground font-mono text-xs" data-user-id={user.id}>账号 ID {user.id}</p>
          <p className="text-muted-foreground text-sm">CSV 导出与 API key 对所有登录用户免费开放。</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link href="/">榜单</Link></Button>
          {isAdmin(user) ? <Button asChild variant="outline" size="sm"><Link href="/admin">后台</Link></Button> : null}
          <form action={logout}><Button type="submit" variant="outline" size="sm">登出</Button></form>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>全量 CSV 导出</CardTitle>
          <CardDescription>
            已发布的全部影响事件，一行一条来源，含来源 URL、媒体、发布日期、原文引述与归因置信度。
            CSV 与 API 暂不包含首页的停运公司档案。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Button asChild><a href="/api/export/records">免费下载 CSV</a></Button>
          <p className="text-muted-foreground text-xs">文件带 UTF-8 BOM，方便用 Excel 打开。也可以带 API key 获取。</p>
        </CardContent>
      </Card>
      <ApiKeysPanel keys={keyRows} />
    </main>
  );
}
