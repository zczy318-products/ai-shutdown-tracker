import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";

import { register } from "../actions";
import { CredentialsForm } from "../credentials-form";

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/admin");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>注册</CardTitle>
          <CardDescription>
            T2 阶段开放自助注册，后续会收紧为邀请制（见 T4 后台权限）。
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
