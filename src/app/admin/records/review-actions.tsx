"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { RECORD_STATUS, labelOf, type RecordStatus } from "@/lib/enums";

import {
  changeRecordStatus,
  deleteRecord,
  publishRecord,
  type RecordFormState,
} from "./actions";

/**
 * Review controls, separate from the editor form so publishing does not require
 * re-submitting the whole record.
 *
 * `publishRecord` re-reads the record from the database and runs the same
 * `checkPublishable` gate the editor runs — pressing this button cannot skip a
 * check that the form would have applied.
 */

type Props = {
  impactId: string;
  status: RecordStatus;
  /**
   * Publish blockers computed server-side for the current stored state, so the
   * reasons are visible before the button is pressed rather than only after.
   */
  blockers: string[];
  warnings: string[];
};

function Feedback({ state }: { state: RecordFormState }) {
  if (!state) return null;
  return (
    <>
      {state.errors?.length ? (
        <div role="alert" className="border-destructive/50 bg-destructive/10 mt-3 space-y-1 rounded-md border p-3 text-sm">
          {state.errors.map((message, index) => (
            <p key={index} className={index === 0 ? "font-medium" : "pl-4"}>
              {message}
            </p>
          ))}
        </div>
      ) : null}
      {state.ok ? (
        <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">操作已完成。</p>
      ) : null}
    </>
  );
}

export function ReviewActions({ impactId, status, blockers, warnings }: Props) {
  const [publishState, publish, publishing] = useActionState<RecordFormState, FormData>(
    publishRecord,
    null,
  );
  const [statusState, changeStatus, changingStatus] = useActionState<RecordFormState, FormData>(
    changeRecordStatus,
    null,
  );
  const [deleteState, remove, removing] = useActionState<RecordFormState, FormData>(
    deleteRecord,
    null,
  );
  const [showReject, setShowReject] = useState(false);

  const canPublish = status !== "published" && blockers.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>审核</CardTitle>
        <CardDescription>
          当前状态：{labelOf(RECORD_STATUS, status)}。
          只有「已发布」会出现在公开前台。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {blockers.length > 0 ? (
          <div className="border-destructive/50 bg-destructive/10 space-y-1 rounded-md border p-3 text-sm">
            <p className="font-medium">按当前已保存的内容，这条记录还不能发布：</p>
            {blockers.map((message, index) => (
              <p key={index} className="pl-4">
                {message}
              </p>
            ))}
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">提醒（不阻止发布）</p>
            {warnings.map((message, index) => (
              <p key={index} className="pl-4">
                {message}
              </p>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <form action={publish}>
            <input type="hidden" name="impactId" value={impactId} />
            <Button type="submit" disabled={publishing || !canPublish}>
              {publishing ? "发布中…" : status === "published" ? "已发布" : "发布"}
            </Button>
          </form>

          {status === "published" ? (
            <form action={changeStatus}>
              <input type="hidden" name="impactId" value={impactId} />
              <input type="hidden" name="nextStatus" value="archived" />
              <Button type="submit" variant="outline" disabled={changingStatus}>
                下架
              </Button>
            </form>
          ) : null}

          {status !== "in_review" && status !== "published" ? (
            <form action={changeStatus}>
              <input type="hidden" name="impactId" value={impactId} />
              <input type="hidden" name="nextStatus" value="in_review" />
              <Button type="submit" variant="secondary" disabled={changingStatus}>
                提交审核
              </Button>
            </form>
          ) : null}

          {status === "archived" || status === "rejected" ? (
            <form action={changeStatus}>
              <input type="hidden" name="impactId" value={impactId} />
              <input type="hidden" name="nextStatus" value="draft" />
              <Button type="submit" variant="outline" disabled={changingStatus}>
                退回草稿
              </Button>
            </form>
          ) : null}

          {status !== "rejected" ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => setShowReject((value) => !value)}
            >
              拒收…
            </Button>
          ) : null}

          {status === "draft" ? (
            <form action={remove} className="ml-auto">
              <input type="hidden" name="impactId" value={impactId} />
              <Button type="submit" variant="ghost" className="text-destructive" disabled={removing}>
                删除草稿
              </Button>
            </form>
          ) : null}
        </div>

        {showReject ? (
          <form action={changeStatus} className="space-y-2 rounded-md border p-3">
            <input type="hidden" name="impactId" value={impactId} />
            <input type="hidden" name="nextStatus" value="rejected" />
            <label htmlFor="reject-note" className="text-sm font-medium">
              拒收原因（必填，会写入 review_note）
            </label>
            <Textarea id="reject-note" name="reviewNote" rows={2} required />
            <Button type="submit" variant="destructive" size="sm" disabled={changingStatus}>
              确认拒收
            </Button>
          </form>
        ) : null}

        {status !== "draft" ? (
          <p className="text-muted-foreground text-xs">
            已进入审核或曾发布的记录不做物理删除（数据字典 §0）：用「下架」把它从前台撤下，
            数据与来源留痕保留在库里。
          </p>
        ) : null}

        <Feedback state={publishState} />
        <Feedback state={statusState} />
        <Feedback state={deleteState} />
      </CardContent>
    </Card>
  );
}
