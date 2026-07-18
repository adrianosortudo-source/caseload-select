/**
 * Content Performance / Content-to-Matter Attribution -- pure logic.
 *
 * Evidence, not guessing. This module never infers a placement link from
 * topic similarity or timing proximity -- only an exact identifier match
 * against a real, existing placement counts as deterministic. Everything
 * else stays unlinked source evidence, never a fabricated content link.
 */

import type {
  AttributionEvidenceMethod,
  AttributionSelfReportCategory,
  AttributionState,
  ContentAttributionCurrent,
} from "@/lib/types";

// ─── Labels ──────────────────────────────────────────────────────────────

export const ATTRIBUTION_STATE_LABELS: Record<AttributionState, string> = {
  known_first_touch: "Observed (first touch)",
  known_assisted: "Observed (assisted)",
  self_reported: "Self-reported",
  offline_referral: "Offline referral",
  unknown: "Unknown",
};

export const EVIDENCE_METHOD_LABELS: Record<AttributionEvidenceMethod, string> = {
  verified_utm: "Verified UTM parameters",
  observed_referrer: "Observed referrer",
  verified_landing_path: "Verified landing page path",
  self_report: "Prospect self-report",
  operator_offline_referral: "Operator-recorded offline referral",
  imported_crm_outcome: "Imported CRM outcome",
  insufficient_evidence: "Insufficient evidence",
};

export const SELF_REPORT_CATEGORY_LABELS: Record<AttributionSelfReportCategory, string> = {
  referral: "Referral",
  search: "Search",
  social: "Social media",
  ai_tool: "AI tool (e.g. ChatGPT)",
  event: "Event",
  existing_client: "Existing client",
  other: "Other",
};

// Ranking used by the content_attribution_current view (kept in sync by
// hand -- see the CASE expression in
// supabase/migrations/20260717030000_content_attribution_evidence.sql).
// Used here only for display/sort purposes in TypeScript, never to
// recompute "current" state client-side; the view is the source of truth.
const STATE_PRIORITY: Record<AttributionState, number> = {
  known_first_touch: 1,
  known_assisted: 2,
  self_reported: 3,
  offline_referral: 4,
  unknown: 5,
};

export function compareAttributionStatePriority(a: AttributionState, b: AttributionState): number {
  return STATE_PRIORITY[a] - STATE_PRIORITY[b];
}

// ─── Observed-evidence normalization (Phase 2A) ─────────────────────────

export interface ObservedLeadSignal {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrer: string | null;
  observedAt: string;
}

export interface PlacementMatchCandidate {
  id: string;
  deliverableId: string;
}

export interface DerivedEvidenceCandidate {
  attributionState: AttributionState;
  evidenceMethod: AttributionEvidenceMethod;
  evidencePayload: Record<string, string | null>;
  deliverableId: string | null;
  placementId: string | null;
  observedAt: string;
}

/**
 * Normalizes UTM/referrer data already captured on a screened_leads row
 * into an attribution evidence candidate. Returns null when there is
 * nothing to normalize (no UTM fields, no referrer) -- the caller decides
 * whether to record an explicit `unknown` row for that case.
 *
 * A placement link is attached ONLY when utm_content or utm_term exactly
 * equals a real placement id for this firm. No fuzzy, topic, or timing
 * matching. No match found is not an error -- it is preserved as
 * unlinked source evidence (deliverableId/placementId stay null), never
 * an invented link.
 */
export function deriveObservedEvidence(
  signal: ObservedLeadSignal,
  placements: PlacementMatchCandidate[],
): DerivedEvidenceCandidate | null {
  const hasUtm = Boolean(
    signal.utmSource || signal.utmMedium || signal.utmCampaign || signal.utmTerm || signal.utmContent,
  );
  const hasReferrer = Boolean(signal.referrer);

  if (!hasUtm && !hasReferrer) return null;

  const matched = placements.find(
    (p) => p.id === signal.utmContent || p.id === signal.utmTerm,
  );

  return {
    attributionState: "known_first_touch",
    evidenceMethod: hasUtm ? "verified_utm" : "observed_referrer",
    evidencePayload: {
      utm_source: signal.utmSource,
      utm_medium: signal.utmMedium,
      utm_campaign: signal.utmCampaign,
      utm_term: signal.utmTerm,
      utm_content: signal.utmContent,
      referrer: signal.referrer,
    },
    deliverableId: matched?.deliverableId ?? null,
    placementId: matched?.id ?? null,
    observedAt: signal.observedAt,
  };
}

// ─── Client-safe reporting language (Phase 3 / Phase 4) ────────────────

export const MIN_SAMPLE_FOR_OBSERVATION = 5;

export function hasSufficientSampleSize(n: number): boolean {
  return n >= MIN_SAMPLE_FOR_OBSERVATION;
}

export interface AttributionStateCounts {
  known_first_touch: number;
  known_assisted: number;
  self_reported: number;
  offline_referral: number;
  unknown: number;
}

export function emptyAttributionStateCounts(): AttributionStateCounts {
  return {
    known_first_touch: 0,
    known_assisted: 0,
    self_reported: 0,
    offline_referral: 0,
    unknown: 0,
  };
}

export function countByAttributionState(
  rows: Pick<ContentAttributionCurrent, "attribution_state">[],
): AttributionStateCounts {
  const counts = emptyAttributionStateCounts();
  for (const row of rows) counts[row.attribution_state] += 1;
  return counts;
}

function pluralEnquiry(n: number): string {
  return n === 1 ? "enquiry has" : "enquiries have";
}

/**
 * Client/lawyer-safe sentences describing attribution evidence for a
 * single deliverable or placement. Never claims a matter or client was
 * "generated" -- only that an enquiry has an evidence-graded connection.
 * See docs/CONTENT_STUDIO_SEO_AEO_SPEC.md sibling doctrine and the
 * Content Performance client-language guidelines for the rule this
 * encodes: observation, not causation.
 */
export function buildClientSafeAttributionSentences(counts: AttributionStateCounts): string[] {
  const lines: string[] = [];
  const observed = counts.known_first_touch + counts.known_assisted;

  if (observed > 0) {
    lines.push(`${observed} ${pluralEnquiry(observed)} an observed connection to this content.`);
  }
  if (counts.self_reported > 0) {
    lines.push(`${counts.self_reported} ${pluralEnquiry(counts.self_reported)} a self-reported connection to this content.`);
  }
  if (counts.offline_referral > 0) {
    lines.push(`${counts.offline_referral} ${pluralEnquiry(counts.offline_referral)} an offline-referral connection to this content.`);
  }
  if (counts.unknown > 0) {
    lines.push(`${counts.unknown} additional ${pluralEnquiry(counts.unknown)} insufficient evidence to attribute to any source.`);
  }
  return lines;
}
