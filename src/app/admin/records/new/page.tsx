import Link from "next/link";

import { requireEditor } from "@/lib/auth";

import { createRecord } from "../actions";
import { RecordForm } from "../record-form";

export const dynamic = "force-dynamic";

export default async function NewRecordPage() {
  // This page reads nothing, so it never leaked anything into a redirect body
  // — but it renders the record editor, and an account that may not write has
  // no business being handed the form. Gated in the body like every other page
  // under /admin, not only in the layout (ZCZ-15).
  //
  // The form it renders posts to `createRecord`, which checks the role again
  // on its own. Two checks, because this one is about what gets rendered and
  // that one is about what gets written: a hidden button is not a gate.
  await requireEditor();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/admin/records" className="text-muted-foreground text-sm hover:underline">
          ← 返回记录列表
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">新建记录</h1>
        <p className="text-muted-foreground text-sm">
          一条记录 = 一家公司 + 一次 AI 影响事件 + 至少一条来源。同一家公司的第二次事件，
          填相同的 slug 即可挂在同一家公司下。
        </p>
      </div>

      <RecordForm action={createRecord} mode="create" />
    </div>
  );
}
