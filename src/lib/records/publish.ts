import {
  ATTRIBUTION_CONFIDENCE,
  FIRST_HAND_SOURCE_TYPES,
  LINK_HEALTH,
  type AttributionConfidence,
  type SourceType,
  labelOf,
} from "@/lib/enums";

/**
 * The publish gate: data dictionary §3, "服务端业务校验" — the four rules the
 * database cannot express, plus the `bot_blocked` rule from §1.9.
 *
 * Every rule answers "is the *claimed* attribution supported by the evidence on
 * file?". None of them decides the attribution: an editor picks the grade, and
 * this only refuses to publish a grade the sources do not carry. Downgrading
 * the grade is the editor's call, never the code's.
 *
 * Checked on every publish attempt, and again on every save of an already
 * published record, so a record cannot lose its evidence after the fact.
 */

/** Just enough of a source row for the rules; satisfied by both input and rows. */
export type SourceFacts = {
  url: string;
  mediaName: string;
  publishedAt: string;
  quote: string;
  sourceType: SourceType;
  linkHealth: keyof typeof LINK_HEALTH;
  manuallyVerified: boolean;
};

export type PublishCheck = {
  /** Hard failures. Non-empty means the record must not be published. */
  errors: string[];
  /** Surfaced in the UI but never blocking. */
  warnings: string[];
};

export type RecordFacts = {
  attributionConfidence: AttributionConfidence;
  counterEvidence: string | null;
  sources: readonly SourceFacts[];
};

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim() === "";
}

export function checkPublishable(record: RecordFacts): PublishCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { sources } = record;

  // Rule 1 — at least one source.
  if (sources.length === 0) {
    errors.push("记录没有任何来源。发布要求至少一条来源（含 URL、媒体名、发布日期与原文引述）。");
    // Every later rule reads the sources, so there is nothing more to say.
    return { errors, warnings };
  }

  // Rule 3 — each source carries all four mandatory fields. The schema and the
  // database both enforce this on write; re-checking here covers rows written
  // before a constraint existed, and makes the publish refusal name the row.
  sources.forEach((item, index) => {
    const missing = [
      isBlank(item.url) ? "URL" : null,
      isBlank(item.mediaName) ? "媒体名" : null,
      isBlank(item.publishedAt) ? "发布日期" : null,
      isBlank(item.quote) ? "原文引述（quote）" : null,
    ].filter((label): label is string => label !== null);

    if (missing.length > 0) {
      errors.push(`第 ${index + 1} 条来源缺少必填项：${missing.join("、")}。`);
    }
  });

  // Rule 2 — a "high" grade needs first-hand or tier-1 evidence.
  if (record.attributionConfidence === "high") {
    const hasFirstHand = sources.some((item) =>
      FIRST_HAND_SOURCE_TYPES.includes(item.sourceType),
    );
    if (!hasFirstHand) {
      errors.push(
        `归因置信度为「${labelOf(ATTRIBUTION_CONFIDENCE, "high")}」时，` +
          "至少需要一条「公司一手材料」或「主流媒体原创报道」类型的来源。" +
          "补一手来源，或把置信度下调为「中」。",
      );
    }
  }

  // Rule 4 — the evidence cannot be entirely dead links.
  if (sources.every((item) => item.linkHealth === "dead")) {
    errors.push(
      "所有来源的链接状态都是「失效」。失效来源不得作为已发布记录的唯一来源，" +
        "请补一条可达来源或归档快照（archive_url）后再发布。",
    );
  }

  // §1.9 — a bot-blocked link is only evidence if a human opened it.
  sources.forEach((item, index) => {
    if (item.linkHealth === "bot_blocked" && !item.manuallyVerified) {
      errors.push(
        `第 ${index + 1} 条来源的链接状态是「反爬拦截」，` +
          "必须勾选「已人工在浏览器中确认可访问」才能发布。",
      );
    }
  });

  // Non-blocking: the dictionary strongly recommends counter-evidence whenever
  // the grade is anything short of high, so the public page can show both sides.
  if (record.attributionConfidence !== "high" && isBlank(record.counterEvidence)) {
    warnings.push(
      `置信度为「${labelOf(ATTRIBUTION_CONFIDENCE, record.attributionConfidence)}」的记录` +
        "强烈建议填写反方证据（公司否认、分析师提出的其他原因等），否则前台只会呈现单方面说法。",
    );
  }

  if (sources.length === 1) {
    warnings.push("只有一条来源。两条以上互相独立的来源会让这条记录结实得多。");
  }

  return { errors, warnings };
}

/** `checkPublishable` as a boolean, for list rendering. */
export function isPublishable(record: RecordFacts): boolean {
  return checkPublishable(record).errors.length === 0;
}
