import { NextResponse } from "next/server";

import { authenticateApiKey, readApiKeyFromHeaders } from "@/lib/api-keys";
import { listPublishedRecords } from "@/lib/records/store";

/**
 * The free, authenticated read-only API.
 *
 * `GET /api/v1/records` — published records with their full source list,
 * authenticated by an API key. Read-only by construction: this file exports
 * only `GET`, so Next answers every other method with 405 and there is no
 * write path to review.
 *
 * The payload deliberately mirrors the CSV's contract — every record ships
 * with its `attributionConfidence` and its sources, including the verbatim
 * quote. A consumer should never be able to ingest a claim from this API
 * without also receiving how well evidenced it is.
 */

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export async function GET(request: Request) {
  const auth = await authenticateApiKey(readApiKeyFromHeaders(request.headers));
  if (!auth.ok) {
    return NextResponse.json(
      {
        error: auth.failure.code,
        message: auth.failure.messageZh,
        docs: new URL("/account", request.url).toString(),
      },
      {
        status: auth.failure.status,
        // Tells a well-behaved client *how* to authenticate rather than only
        // that it failed to.
        headers: { "www-authenticate": 'Bearer realm="rest-in-prompts"' },
      },
    );
  }

  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

  const all = await listPublishedRecords();
  const page = all.slice(offset, offset + limit);

  return NextResponse.json(
    {
      total: all.length,
      limit,
      offset,
      // Stated in the payload, not just in the docs: an integrator reading a
      // response for the first time should see the grade is part of the data.
      notice:
        "每条记录都附带 attributionConfidence 评级与来源原文引述。本数据集不生产因果结论，" +
        "请勿在引用时省略评级。",
      records: page.map(({ impact, company, sources }) => ({
        id: impact.id,
        eventDate: impact.eventDate,
        eventDatePrecision: impact.eventDatePrecision,
        impactType: impact.impactType,
        attributionConfidence: impact.attributionConfidence,
        outcome: impact.outcome,
        summary: impact.summary,
        summaryEn: impact.summaryEn,
        employeesAffected: impact.employeesAffected,
        employeesAffectedPct: impact.employeesAffectedPct,
        revenueImpactNote: impact.revenueImpactNote,
        counterEvidence: impact.counterEvidence,
        isPrimary: impact.isPrimary,
        company: {
          slug: company.slug,
          name: company.name,
          nameZh: company.nameZh,
          countryCode: company.countryCode,
          region: company.region,
          industry: company.industry,
          companySize: company.companySize,
          websiteUrl: company.websiteUrl,
        },
        sources: sources.map((item) => ({
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
        })),
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
