import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";

import { register } from "../actions";
import { CredentialsForm } from "../credentials-form";

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/account");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>注册</CardTitle>
          <CardDescription>
            注册免费账户以导出资料和管理 API 密钥。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CredentialsForm action={register} submitLabel="注册" mode="register" />
          <p className="text-muted-foreground text-sm">
            已有账号？{" "}
            <Link href="/login" className="text-foreground underline underline-offset-4">
              登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
