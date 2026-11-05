import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";

import { login } from "../actions";
import { CredentialsForm } from "../credentials-form";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/account");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>登录</CardTitle>
          <CardDescription>登录后可导出资料和管理 API 密钥。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CredentialsForm action={login} submitLabel="登录" mode="login" />
          <p className="text-muted-foreground text-sm">
            还没有账号？{" "}
            <Link href="/register" className="text-foreground underline underline-offset-4">
              注册
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
