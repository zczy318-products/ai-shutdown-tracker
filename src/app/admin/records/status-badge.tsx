import { Badge } from "@/components/ui/badge";
import {
  ATTRIBUTION_CONFIDENCE,
  LINK_HEALTH,
  RECORD_STATUS,
  labelOf,
  type AttributionConfidence,
  type LinkHealth,
  type RecordStatus,
} from "@/lib/enums";

/**
 * Colour is load-bearing here, not decoration: an editor scanning the review
 * queue needs to see at a glance which rows are live and which grades are
 * resting on soft evidence. The label text always ships alongside it.
 */

const STATUS_VARIANT: Record<RecordStatus, "success" | "warning" | "secondary" | "destructive"> = {
  draft: "secondary",
  in_review: "warning",
  published: "success",
  rejected: "destructive",
  archived: "secondary",
};

export function StatusBadge({ status }: { status: RecordStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{labelOf(RECORD_STATUS, status)}</Badge>;
}

const CONFIDENCE_VARIANT: Record<AttributionConfidence, "success" | "warning" | "outline"> = {
  high: "success",
  medium: "warning",
  low: "outline",
};

export function ConfidenceBadge({ confidence }: { confidence: AttributionConfidence }) {
  return (
    <Badge variant={CONFIDENCE_VARIANT[confidence]}>
      归因 {labelOf(ATTRIBUTION_CONFIDENCE, confidence)}
    </Badge>
  );
}

const LINK_HEALTH_VARIANT: Record<LinkHealth, "success" | "warning" | "destructive"> = {
  ok: "success",
  bot_blocked: "warning",
  unreachable: "warning",
  dead: "destructive",
};

export function LinkHealthBadge({ health }: { health: LinkHealth }) {
  return <Badge variant={LINK_HEALTH_VARIANT[health]}>{labelOf(LINK_HEALTH, health)}</Badge>;
}
