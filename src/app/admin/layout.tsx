import Link from "next/link";
import { redirect } from "next/navigation";

import { logout } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";

/**
 * The single auth gate for everything under /admin. Server-side by design —
 * middleware can only see that a cookie exists, not that the session is valid.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-4">
        <div className="flex items-center gap-6">
          <Link href="/admin" className="font-semibold">
            Rest In Prompts 后台
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin/records" className="text-muted-foreground hover:text-foreground">
              记录
            </Link>
            <Link
              href="/admin/records?status=in_review"
              className="text-muted-foreground hover:text-foreground"
            >
              待审核
            </Link>
            <Link href="/admin/records/new" className="text-muted-foreground hover:text-foreground">
              新建
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground text-sm">{user.email}</span>
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              登出
            </Button>
          </form>
        </div>
      </header>
      {/* Wider than the auth pages: the record editor is a two-column form. */}
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
