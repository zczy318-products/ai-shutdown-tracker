import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { landingPathFor } from "@/lib/roles";

import { login } from "../actions";
import { CredentialsForm } from "../credentials-form";

export default async function LoginPage() {
  // By role: a viewer opening /login must not be thrown at /admin, which would
  // only refuse them (ZCZ-15).
  const signedIn = await getCurrentUser();
  if (signedIn) redirect(landingPathFor(signedIn.role));

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>登录</CardTitle>
          <CardDescription>登录后可访问录入与审核后台。</CardDescription>
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
