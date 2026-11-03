import {
  ATTRIBUTION_CONFIDENCE,
  IMPACT_TYPE,
  INDUSTRY,
  LINK_HEALTH,
  OUTCOME,
  REGION,
  SOURCE_TYPE,
  countryLabel,
  labelOf,
} from "@/lib/enums";
import type { FullRecord } from "@/lib/records/store";

/**
 * The pro export.
 *
 * Shape: **one row per source**, with the company and event columns repeated.
 * The alternative — one row per event with the sources packed into a cell —
 * makes the thing the dataset exists for (the URL and the verbatim quote)
 * unusable in a spreadsheet, and quotes contain commas and newlines, so
 * packing them is also where the escaping bugs live. The long form is what
 * anyone doing real work with this will pivot anyway.
 *
 * `source_index` / `source_count` are included so the event-level view can be
 * reconstructed exactly, and `ai_impact_id` is stable across exports.
 *
 * Every row carries `attribution_confidence`. A grade-free export would let
 * someone treat a "low" record as an established fact the moment the data
 * leaves this site, which is the failure mode the whole project is built to
 * avoid.
 */

export const EXPORT_COLUMNS = [
  "ai_impact_id",
  "company_slug",
  "company_name",
  "company_name_zh",
  "company_country_code",
  "company_country",
  "company_region",
  "company_industry",
  "company_size",
  "company_website_url",
  "event_date",
  "event_date_precision",
  "impact_type",
  "attribution_confidence",
  "outcome",
  "employees_affected",
  "employees_affected_pct",
  "is_primary",
  "summary_zh",
  "summary_en",
  "revenue_impact_note",
  "counter_evidence",
  "record_status",
  "source_index",
  "source_count",
  "source_url",
  "source_media_name",
  "source_type",
  "source_published_at",
  "source_title",
  "source_author",
  "source_quote",
  "source_quote_lang",
  "source_quote_translation_zh",
  "source_archive_url",
  "source_link_health",
  "source_manually_verified",
  "exported_at",
] as const;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

/**
 * RFC 4180 quoting.
 *
 * The leading-separator guard is not cosmetic: a quote beginning with `=`,
 * `+`, `-` or `@` is executed as a formula when the CSV is opened in Excel or
 * Sheets. Since every quote in this dataset is attacker-influenced text copied
 * from the open web, prefixing a single quote character neutralises the
 * injection while leaving the cell's displayed text unchanged.
 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "boolean" ? (value ? "true" : "false") : String(value);

  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function toCsvRow(values: readonly unknown[]): string {
  return values.map(escapeCell).join(",");
}

/** One CSV row per (event, source) pair, in `EXPORT_COLUMNS` order. */
export function recordRows(record: FullRecord, exportedAt: string): unknown[][] {
  const { impact, company, sources } = record;
  const sourceCount = sources.length;

  return sources.map((item, index) => [
    impact.id,
    company.slug,
    company.name,
    company.nameZh,
    company.countryCode,
    countryLabel(company.countryCode),
    labelOf(REGION, company.region),
    labelOf(INDUSTRY, company.industry),
    company.companySize,
    company.websiteUrl,
    impact.eventDate,
    impact.eventDatePrecision,
    labelOf(IMPACT_TYPE, impact.impactType),
    labelOf(ATTRIBUTION_CONFIDENCE, impact.attributionConfidence),
    labelOf(OUTCOME, impact.outcome),
    impact.employeesAffected,
    impact.employeesAffectedPct,
    impact.isPrimary,
    impact.summary,
    impact.summaryEn,
    impact.revenueImpactNote,
    impact.counterEvidence,
    impact.recordStatus,
    index + 1,
    sourceCount,
    item.url,
    item.mediaName,
    labelOf(SOURCE_TYPE, item.sourceType),
    item.publishedAt,
    item.title,
    item.author,
    item.quote,
    item.quoteLang,
    item.quoteTranslationZh,
    item.archiveUrl,
    labelOf(LINK_HEALTH, item.linkHealth),
    item.manuallyVerified,
    exportedAt,
  ]);
}

/**
 * The whole file as a string.
 *
 * The dataset is a few thousand rows at most, so building it in memory is
 * simpler than streaming and keeps the route handler readable. Revisit if the
 * record count reaches six figures.
 *
 * `﻿` is a UTF-8 BOM. Excel on Windows reads a BOM-less UTF-8 CSV as the
 * system code page and turns every Chinese summary into mojibake; the BOM is
 * what makes a double-click open correctly, and every other tool ignores it.
 */
export function buildCsv(records: FullRecord[], options: { exportedAt?: Date } = {}): string {
  const exportedAt = (options.exportedAt ?? new Date()).toISOString();
  const lines = [toCsvRow(EXPORT_COLUMNS)];

  for (const record of records) {
    for (const row of recordRows(record, exportedAt)) {
      lines.push(toCsvRow(row));
    }
  }

  // CRLF: RFC 4180's line ending, and the one Excel is least surprised by.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function exportFilename(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return `rest-in-prompts-records-${stamp}.csv`;
}
