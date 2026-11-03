import Link from "next/link";

import { logout } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { requireEditor } from "@/lib/auth";

/**
 * The chrome and the *outer* role gate for everything under /admin.
 * Server-side by design — middleware can only see that a cookie exists, not
 * that the session is valid, let alone what the account is allowed to do.
 *
 * `requireEditor()` and not `requireUser()`: registration is open to anyone,
 * so a valid session is a fact about a stranger. The role is the permission
 * (ZCZ-15).
 *
 * It is not the only gate, and must not be treated as one: Next renders this
 * layout and the page under it concurrently, so redirecting here does not stop
 * the page from running its queries. **Every** page under /admin calls
 * `requireEditor()` in its own body as well — including the ones that read
 * nothing. See the note on `requireEditor` for the leak that proved it.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireEditor();

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
            <Link href="/admin/subscribers" className="text-muted-foreground hover:text-foreground">
              订阅者
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
