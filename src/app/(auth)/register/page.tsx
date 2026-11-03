import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { landingPathFor } from "@/lib/roles";

import { register } from "../actions";
import { CredentialsForm } from "../credentials-form";

export default async function RegisterPage() {
  const signedIn = await getCurrentUser();
  if (signedIn) redirect(landingPathFor(signedIn.role));

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>注册</CardTitle>
          <CardDescription>
            注册得到的是一个<strong>只读账号</strong>：可以订阅、导出与使用 API key，
            不能录入或修改任何记录。录入权限由管理员单独授予。
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
