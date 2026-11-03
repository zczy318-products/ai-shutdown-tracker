"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import type { RecordStatus } from "@/lib/enums";
import { parseRecordForm } from "@/lib/records/form-data";
import { checkPublishable, type SourceFacts } from "@/lib/records/publish";
import {
  RecordWriteError,
  deleteDraftRecord,
  getRecord,
  saveRecord,
  setRecordStatus,
} from "@/lib/records/store";
import {
  describeDescriptionWarnings,
  fieldErrorsOf,
  recordInputSchema,
  type RecordInput,
} from "@/lib/records/validation";

/**
 * Every write to the record tables goes through this file.
 *
 * Order of checks is deliberate and is the same for a save and for a publish:
 *
 *   1. authentication — a server action is a public endpoint, the page's auth
 *      gate does not cover it;
 *   2. `recordInputSchema` — shape, required fields, at least one source;
 *   3. `checkPublishable` — the dictionary §3 business rules, applied when the
 *      target status is `published` (and re-applied whenever an already
 *      published record is edited, so it cannot lose its evidence later);
 *   4. the database, whose constraints and deferred trigger are the backstop.
 *
 * A rejection always names its reason. "保存失败" with no cause is the failure
 * mode that makes an editor give up and paste a weaker source instead.
 */

export type RecordFormState = {
  /** Keyed by form field path, e.g. `sources.0.quote`. */
  fieldErrors?: Record<string, string>;
  /** Reasons the record cannot be saved or published, in plain language. */
  errors?: string[];
  /** Advisory only; the save still went through. */
  warnings?: string[];
  ok?: boolean;
} | null;

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Source rows as `checkPublishable` wants them, straight from the input. */
function sourceFactsOf(input: RecordInput): SourceFacts[] {
  return input.sources.map((item) => ({
    url: item.url,
    mediaName: item.mediaName,
    publishedAt: item.publishedAt,
    quote: item.quote,
    sourceType: item.sourceType,
    linkHealth: item.linkHealth,
    manuallyVerified: item.manuallyVerified,
  }));
}

/**
 * `saveRecord` can still be refused by the database — a slug that collides, a
 * second primary event for one company, the source trigger. Those messages are
 * Postgres's, so translate the ones an editor can actually act on.
 */
function explainDbError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("ai_impact_one_primary_per_company")) {
    return "这家公司已经有一条「主事件」了。榜单每家公司只展示一条，请先取消另一条的主事件标记。";
  }
  if (message.includes("has no source row") || message.includes("no source row")) {
    return "数据库拒绝了这次写入：记录没有任何来源。每条记录至少需要一条完整来源。";
  }
  if (message.includes("source_impact_url_unique")) {
    return "同一事件下重复录入了同一个来源 URL。";
  }
  if (message.includes("source_quote_length_check")) {
    return "数据库拒绝了这次写入：原文引述长度必须在 20 到 2000 字符之间。";
  }
  if (message.includes("source_url_format")) {
    return "数据库拒绝了这次写入：来源 URL 必须以 http:// 或 https:// 开头。";
  }
  if (message.includes("company_slug_unique")) {
    return "slug 与另一家公司冲突。";
  }
  if (error instanceof RecordWriteError) {
    return error.message;
  }

  console.error("[records] write failed:", error);
  return "保存失败：数据库拒绝了这次写入。请检查字段后重试。";
}

type SaveOptions = { impactId?: string };

async function saveFromForm(
  formData: FormData,
  options: SaveOptions,
): Promise<RecordFormState> {
  const user = await requireUser();

  // Layer 2a — shape and required fields, including "at least one source".
  const parsed = recordInputSchema.safeParse(parseRecordForm(formData));
  if (!parsed.success) {
    const fieldErrors = fieldErrorsOf(parsed.error);
    return {
      fieldErrors,
      // `sources` with no index is the min(1) failure, which has no field to
      // attach to — surface it at the top of the form instead.
      errors: Object.entries(fieldErrors)
        .filter(([key]) => key === "sources" || key === "_")
        .map(([, message]) => message),
    };
  }

  const input = parsed.data;
  const warnings = describeDescriptionWarnings(input.company.description);

  // Layer 2b — the publish gate, for a publish or an edit of a live record.
  const alreadyPublished = options.impactId
    ? (await getRecord(options.impactId))?.impact.recordStatus === "published"
    : false;

  if (input.status === "published" || alreadyPublished) {
    const check = checkPublishable({
      attributionConfidence: input.impact.attributionConfidence,
      counterEvidence: input.impact.counterEvidence,
      sources: sourceFactsOf(input),
    });
    if (check.errors.length > 0) {
      return {
        errors: [
          alreadyPublished && input.status !== "published"
            ? "这条记录已发布，改动必须仍然满足发布要求："
            : "无法发布，原因如下：",
          ...check.errors,
        ],
      };
    }
    warnings.push(...check.warnings);
  }

  if (input.status === "rejected" && !input.impact.reviewNote) {
    return { fieldErrors: { "impact.reviewNote": "拒收时必须写明审核意见。" } };
  }

  let impactId: string;
  try {
    impactId = await saveRecord(input, { impactId: options.impactId, reviewedBy: user.id });
  } catch (error) {
    return { errors: [explainDbError(error)] };
  }

  revalidatePath("/admin/records");
  revalidatePath(`/admin/records/${impactId}`);
  revalidatePath("/");

  if (!options.impactId) {
    // A fresh record: land the editor on the saved row so the next action
    // (adding a source, publishing) works on a real id.
    redirect(`/admin/records/${impactId}?saved=1`);
  }

  return { ok: true, warnings: warnings.length > 0 ? warnings : undefined };
}

export async function createRecord(
  _prev: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  return saveFromForm(formData, {});
}

export async function updateRecord(
  _prev: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const impactId = String(formData.get("impactId") ?? "");
  if (!impactId) return { errors: ["缺少记录 ID。"] };
  return saveFromForm(formData, { impactId });
}

/**
 * draft / in_review → published.
 *
 * Re-reads the record from the database rather than trusting the form, because
 * the publish button may be pressed from the list page where no form was
 * filled in. The gate is the same `checkPublishable` the editor runs.
 */
export async function publishRecord(
  _prev: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const user = await requireUser();
  const impactId = String(formData.get("impactId") ?? "");
  if (!impactId) return { errors: ["缺少记录 ID。"] };

  const record = await getRecord(impactId);
  if (!record) return { errors: ["记录不存在或已被删除。"] };

  const check = checkPublishable({
    attributionConfidence: record.impact.attributionConfidence,
    counterEvidence: record.impact.counterEvidence,
    sources: record.sources.map((item) => ({
      url: item.url,
      mediaName: item.mediaName,
      publishedAt: item.publishedAt,
      quote: item.quote,
      sourceType: item.sourceType,
      linkHealth: item.linkHealth,
      manuallyVerified: item.manuallyVerified,
    })),
  });

  if (check.errors.length > 0) {
    return { errors: ["无法发布，原因如下：", ...check.errors] };
  }

  await setRecordStatus(impactId, "published", { reviewedBy: user.id });

  revalidatePath("/admin/records");
  revalidatePath(`/admin/records/${impactId}`);
  revalidatePath("/");
  return { ok: true, warnings: check.warnings.length > 0 ? check.warnings : undefined };
}

/**
 * Takes a record off the public site. Dictionary §0: no physical deletes, so
 * this is a status change and the row and its evidence stay on file.
 */
export async function changeRecordStatus(
  _prev: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const user = await requireUser();
  const impactId = String(formData.get("impactId") ?? "");
  const status = String(formData.get("nextStatus") ?? "") as RecordStatus;
  const reviewNote = String(formData.get("reviewNote") ?? "").trim() || null;

  if (!impactId) return { errors: ["缺少记录 ID。"] };
  if (status === "published") {
    // Publishing has a gate; routing it through here would bypass it.
    return { errors: ["请使用发布动作，发布需要先通过来源完整性校验。"] };
  }
  if (!["draft", "in_review", "rejected", "archived"].includes(status)) {
    return { errors: ["未知的目标状态。"] };
  }
  if (status === "rejected" && !reviewNote) {
    return { errors: ["拒收时必须写明原因。"] };
  }

  await setRecordStatus(impactId, status, { reviewNote, reviewedBy: user.id });

  revalidatePath("/admin/records");
  revalidatePath(`/admin/records/${impactId}`);
  revalidatePath("/");
  return { ok: true };
}

/** Only for a draft that was never published; see `deleteDraftRecord`. */
export async function deleteRecord(
  _prev: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  await requireUser();
  const impactId = String(formData.get("impactId") ?? "");
  if (!impactId) return { errors: ["缺少记录 ID。"] };

  const record = await getRecord(impactId);
  if (!record) return { errors: ["记录不存在或已被删除。"] };
  if (record.impact.recordStatus !== "draft") {
    return {
      errors: [
        "只有草稿可以删除。已进入审核或曾发布的记录请用「下架」，" +
          "数据与来源留痕要保留（数据字典 §0）。",
      ],
    };
  }

  await deleteDraftRecord(impactId);
  revalidatePath("/admin/records");
  redirect("/admin/records?deleted=1");
}
