import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { requireEditor } from "@/lib/auth";
import { SOURCE_TYPE, labelOf } from "@/lib/enums";
import { checkPublishable } from "@/lib/records/publish";
import { getRecord } from "@/lib/records/store";

import { updateRecord } from "../actions";
import { RecordForm } from "../record-form";
import { ReviewActions } from "../review-actions";
import { ConfidenceBadge, LinkHealthBadge, StatusBadge } from "../status-badge";

export const dynamic = "force-dynamic";

export default async function EditRecordPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEditor();

  const { id } = await params;
  const record = await getRecord(id);
  if (!record) notFound();

  const { impact, company, sources } = record;

  // Computed from what is *stored*, not from the form, so the review panel
  // reflects the record as it would be published right now.
  const check = checkPublishable({
    attributionConfidence: impact.attributionConfidence,
    counterEvidence: impact.counterEvidence,
    sources: sources.map((item) => ({
      url: item.url,
      mediaName: item.mediaName,
      publishedAt: item.publishedAt,
      quote: item.quote,
      sourceType: item.sourceType,
      linkHealth: item.linkHealth,
      manuallyVerified: item.manuallyVerified,
    })),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/admin/records" className="text-muted-foreground text-sm hover:underline">
          ← 返回记录列表
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {company.nameZh ? `${company.name}（${company.nameZh}）` : company.name}
          </h1>
          <StatusBadge status={impact.recordStatus} />
          <ConfidenceBadge confidence={impact.attributionConfidence} />
          {impact.isPrimary ? <Badge variant="outline">主事件</Badge> : null}
        </div>
        <p className="text-muted-foreground font-mono text-xs">
          {impact.eventDate} · {company.slug} · {impact.id}
        </p>
        {impact.reviewNote ? (
          <p className="text-muted-foreground text-sm">审核意见：{impact.reviewNote}</p>
        ) : null}
      </div>

      <ReviewActions
        impactId={impact.id}
        status={impact.recordStatus}
        blockers={check.errors}
        warnings={check.warnings}
      />

      {/* A compact read-only view of the stored evidence. The editable copies
          are in the form below; this is what a reviewer actually reads, and it
          shows the verbatim quote in full rather than in a textarea. */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">已存来源（{sources.length} 条）</h2>
        {sources.map((item, index) => (
          <div key={item.id} className="space-y-2 rounded-lg border p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {index + 1}. {item.mediaName}
              </span>
              <Badge variant="outline">{labelOf(SOURCE_TYPE, item.sourceType)}</Badge>
              <LinkHealthBadge health={item.linkHealth} />
              {item.manuallyVerified ? <Badge variant="success">已人工核验</Badge> : null}
              <span className="text-muted-foreground font-mono text-xs">{item.publishedAt}</span>
            </div>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary block truncate text-xs underline"
            >
              {item.url}
            </a>
            <blockquote className="bg-muted/50 border-l-2 py-1 pl-3 text-sm">
              <span className="text-muted-foreground mr-1 text-xs uppercase">
                {item.quoteLang}
              </span>
              {item.quote}
            </blockquote>
            {item.quoteTranslationZh ? (
              <p className="text-muted-foreground pl-3 text-xs">
                译文（非原文）：{item.quoteTranslationZh}
              </p>
            ) : null}
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">编辑</h2>
        <RecordForm
          action={updateRecord}
          mode="edit"
          defaults={{
            impactId: impact.id,
            status: impact.recordStatus,
            company: {
              slug: company.slug,
              name: company.name,
              nameZh: company.nameZh,
              aliases: company.aliases,
              countryCode: company.countryCode,
              industry: company.industry,
              companySize: company.companySize,
              foundedYear: company.foundedYear,
              websiteUrl: company.websiteUrl,
              description: company.description,
              logoUrl: company.logoUrl,
            },
            impact: {
              impactType: impact.impactType,
              attributionConfidence: impact.attributionConfidence,
              outcome: impact.outcome,
              eventDate: impact.eventDate,
              eventDatePrecision: impact.eventDatePrecision,
              summary: impact.summary,
              summaryEn: impact.summaryEn,
              employeesAffected: impact.employeesAffected,
              employeesAffectedPct: impact.employeesAffectedPct,
              revenueImpactNote: impact.revenueImpactNote,
              isPrimary: impact.isPrimary,
              counterEvidence: impact.counterEvidence,
              reviewNote: impact.reviewNote,
            },
            sources: sources.map((item) => ({
              id: item.id,
              url: item.url,
              mediaName: item.mediaName,
              sourceType: item.sourceType,
              publishedAt: item.publishedAt,
              title: item.title,
              author: item.author,
              quote: item.quote,
              quoteLang: item.quoteLang,
              quoteTranslationZh: item.quoteTranslationZh,
              archiveUrl: item.archiveUrl,
              linkHealth: item.linkHealth,
              manuallyVerified: item.manuallyVerified,
            })),
          }}
        />
      </section>
    </div>
  );
}
