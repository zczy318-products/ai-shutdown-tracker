import { Badge } from "@/components/ui/badge";
import {
  ATTRIBUTION_CONFIDENCE,
  IMPACT_TYPE,
  OUTCOME,
  labelOf,
  type AttributionConfidence,
  type ImpactType,
  type Outcome,
} from "@/lib/enums";
import { cn } from "@/lib/utils";

/**
 * The badges that carry a grading on the public pages.
 *
 * Three rules from the ZCZ-6 design spec are implemented here rather than left
 * to each page, because getting them wrong would make the site assert something
 * the sources do not:
 *
 *  - §3.1 confidence is a **colourless ordinal** ladder. It says how hard the
 *    evidence is, not how damning the story is, so it is rendered in the warm
 *    greys of `--conf-*` and **always** with its text label. Colour never
 *    carries the meaning on its own.
 *  - §3.2 outcome gets **no colour at all**. Painting «停止运营» red would be
 *    the platform taking a position. The single exception is `reversed`, which
 *    is a solid (still colourless) badge because "this was later walked back"
 *    has to be louder than the other outcomes — otherwise a reader stops at a
 *    conclusion the record itself retracts.
 *  - §4.4 impact type owns chart slots 1–4, bound to the value and never to its
 *    rank, so the same category is the same colour in the filter, on the card
 *    and in the dashboard.
 *
 * `--destructive` appears nowhere in this file. It is reserved for real error
 * states in the backoffice.
 */

export const IMPACT_TYPE_BAR: Record<ImpactType, string> = {
  replaced_by_ai_product: "bg-chart-1",
  ai_cost_cutting_layoff: "bg-chart-2",
  voluntary_pivot: "bg-chart-3",
  mentioned_in_coverage: "bg-chart-4",
};

export const CONFIDENCE_BAR: Record<AttributionConfidence, string> = {
  high: "bg-conf-high",
  medium: "bg-conf-medium",
  low: "bg-conf-low",
};

/** Dot + text. The spec requires the label, so colour is never load-bearing. */
export function AttributionBadge({
  confidence,
  className,
}: {
  confidence: AttributionConfidence;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-muted-foreground inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap",
        className,
      )}
      title="归因置信度：按 ZCZ-2 归因标准人工评级，衡量证据强度，不代表对公司的评价"
    >
      <span className={cn("size-2 shrink-0 rounded-full", CONFIDENCE_BAR[confidence])} aria-hidden />
      归因置信度：{labelOf(ATTRIBUTION_CONFIDENCE, confidence)}
    </span>
  );
}

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  return (
    <Badge variant={outcome === "reversed" ? "secondary" : "outline"}>
      {labelOf(OUTCOME, outcome)}
    </Badge>
  );
}

export function ImpactTypeBadge({ impactType }: { impactType: ImpactType }) {
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap">
      <span className={cn("size-2 shrink-0 rounded-full", IMPACT_TYPE_BAR[impactType])} aria-hidden />
      {labelOf(IMPACT_TYPE, impactType)}
    </span>
  );
}
