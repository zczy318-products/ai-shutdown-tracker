import type { RecordStatus } from "@/lib/enums";

/**
 * Turns the flat `FormData` the browser posts into the nested shape
 * `recordInputSchema` expects.
 *
 * Field names in the form are paths — `company.slug`, `impact.summary`,
 * `sources.0.quote`. Keeping the path in the name is what lets a validation
 * error come back out of zod with a path that addresses the exact input that
 * caused it, which matters a great deal on a form with a dozen source fields.
 *
 * Checkboxes are the one special case: an unchecked box sends nothing at all,
 * so absence has to mean `false` rather than "not provided".
 */

type RawSource = Record<string, string | boolean>;

export type ParsedRecordForm = {
  company: Record<string, string>;
  impact: Record<string, string | boolean>;
  sources: RawSource[];
  status: RecordStatus;
};

const CHECKBOX_FIELDS = new Set(["impact.isPrimary", "manuallyVerified"]);

export function parseRecordForm(formData: FormData): ParsedRecordForm {
  const company: Record<string, string> = {};
  const impact: Record<string, string | boolean> = {};
  const sources: RawSource[] = [];

  for (const [key, raw] of formData.entries()) {
    if (typeof raw !== "string") continue;

    if (key.startsWith("company.")) {
      company[key.slice("company.".length)] = raw;
      continue;
    }

    if (key.startsWith("impact.")) {
      const field = key.slice("impact.".length);
      impact[field] = CHECKBOX_FIELDS.has(key) ? raw === "on" || raw === "true" : raw;
      continue;
    }

    // sources.<index>.<field>
    const match = /^sources\.(\d+)\.(.+)$/.exec(key);
    if (match) {
      const index = Number(match[1]);
      const field = match[2];
      sources[index] ??= {};
      sources[index][field] = CHECKBOX_FIELDS.has(field) ? raw === "on" || raw === "true" : raw;
    }
  }

  // Unchecked boxes send nothing, and a removed source row leaves a hole in the
  // index sequence, so normalise both before validation sees them.
  impact.isPrimary ??= false;
  const compacted = sources.filter((item): item is RawSource => Boolean(item));
  for (const item of compacted) {
    item.manuallyVerified ??= false;
  }

  return {
    company,
    impact,
    sources: compacted,
    status: (formData.get("status") as RecordStatus | null) ?? "draft",
  };
}
