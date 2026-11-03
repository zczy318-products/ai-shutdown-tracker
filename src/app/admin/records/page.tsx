import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { requireEditor } from "@/lib/auth";
import {
  IMPACT_TYPE,
  OUTCOME,
  RECORD_STATUS,
  RECORD_STATUS_VALUES,
  labelOf,
  optionsOf,
  type RecordStatus,
} from "@/lib/enums";
import { PAGE_SIZE, countByStatus, listRecords } from "@/lib/records/store";

import { ConfidenceBadge, StatusBadge } from "./status-badge";

/**
 * The review queue. Filter by status and keyword, paginated.
 *
 * Filters live in the URL rather than in client state so a reviewer can keep a
 * tab open on «待审核» and reload it, and so the pagination links are ordinary
 * links. Every read goes through `listRecords`, which never filters by status
 * implicitly — unlike the public queries, the backoffice must be able to see
 * drafts.
 */

export const dynamic = "force-dynamic";

type SearchParams = { status?: string; q?: string; page?: string };

function isStatus(value: string | undefined): value is RecordStatus {
  return Boolean(value) && (RECORD_STATUS_VALUES as readonly string[]).includes(value as string);
}

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireEditor();

  const params = await searchParams;
  const status = isStatus(params.status) ? params.status : "all";
  const q = params.q?.trim() ?? "";
  const page = Number(params.page ?? 1) || 1;

  const [{ items, total, pageCount }, counts] = await Promise.all([
    listRecords({ status, q, page }),
    countByStatus(),
  ]);

  const hrefFor = (next: Partial<SearchParams>) => {
    const search = new URLSearchParams();
    const merged = { status: params.status, q, page: String(page), ...next };
    if (merged.status && merged.status !== "all") search.set("status", merged.status);
    if (merged.q) search.set("q", merged.q);
    if (merged.page && merged.page !== "1") search.set("page", merged.page);
    const query = search.toString();
    return query ? `/admin/records?${query}` : "/admin/records";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">记录</h1>
          <p className="text-muted-foreground text-sm">
            共 {total} 条
            {RECORD_STATUS_VALUES.filter((value) => counts[value]).map((value) => (
              <span key={value} className="ml-2">
                {labelOf(RECORD_STATUS, value)} {counts[value]}
              </span>
            ))}
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/records/new">+ 新建记录</Link>
        </Button>
      </div>

      <form className="flex flex-wrap items-end gap-3" action="/admin/records">
        <div className="space-y-1">
          <label htmlFor="filter-status" className="text-muted-foreground text-xs">
            状态
          </label>
          <Select id="filter-status" name="status" defaultValue={status} className="w-40">
            <option value="all">全部</option>
            {optionsOf(RECORD_STATUS).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="filter-q" className="text-muted-foreground text-xs">
            关键词（公司名 / 中文名 / slug / 别名）
          </label>
          <Input id="filter-q" name="q" defaultValue={q} className="w-72" placeholder="chegg" />
        </div>
        <Button type="submit" variant="secondary">
          筛选
        </Button>
        {status !== "all" || q ? (
          <Button asChild variant="ghost">
            <Link href="/admin/records">清除</Link>
          </Button>
        ) : null}
      </form>

      {items.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
          没有符合条件的记录。
          <Link href="/admin/records/new" className="text-primary ml-1 underline">
            新建一条
          </Link>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {items.map(({ impact, company, sourceCount }) => (
            <div key={impact.id} className="flex flex-wrap items-start gap-4 p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/records/${impact.id}`}
                    className="font-medium hover:underline"
                  >
                    {company.nameZh ? `${company.name}（${company.nameZh}）` : company.name}
                  </Link>
                  <StatusBadge status={impact.recordStatus} />
                  <ConfidenceBadge confidence={impact.attributionConfidence} />
                  {impact.isPrimary ? <Badge variant="outline">主事件</Badge> : null}
                  <Badge variant={sourceCount > 0 ? "outline" : "destructive"}>
                    {sourceCount} 条来源
                  </Badge>
                </div>
                <p className="text-muted-foreground line-clamp-2 text-sm">{impact.summary}</p>
                <p className="text-muted-foreground font-mono text-xs">
                  {impact.eventDate} · {labelOf(IMPACT_TYPE, impact.impactType)} ·{" "}
                  {labelOf(OUTCOME, impact.outcome)} · {company.slug}
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/records/${impact.id}`}>编辑 / 审核</Link>
              </Button>
            </div>
          ))}
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            第 {page} / {pageCount} 页（每页 {PAGE_SIZE} 条）
          </span>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm" disabled={page <= 1}>
              <Link href={hrefFor({ page: String(Math.max(1, page - 1)) })}>上一页</Link>
            </Button>
            <Button asChild variant="outline" size="sm" disabled={page >= pageCount}>
              <Link href={hrefFor({ page: String(Math.min(pageCount, page + 1)) })}>下一页</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
