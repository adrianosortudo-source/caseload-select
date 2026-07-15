/**
 * Publication Readiness, Workstream 4: the pure readiness evaluator.
 *
 * One function, evaluateDeliverableReadiness, is the single source of
 * "ready" for both the UI (Workstream 5) and the manifest (Workstream 6).
 * ready is always derived here, never stored as a column anywhere.
 *
 * Rules encoded (matching the workstream spec and DR-093/094):
 *   - Approval passes only when approved_version_id === current_version_id.
 *   - An artifact passes only when its version_id equals the CURRENT
 *     version. An artifact bound to an older version is stale evidence,
 *     not valid evidence, and is reported as such (not silently ignored).
 *   - Missing metadata (role/locale unset) fails closed.
 *   - Missing localized routes fail closed when the requirement profile
 *     requires them.
 *   - Archived deliverables return "excluded", never "ready".
 *   - Unknown states fail closed.
 *   - No network calls happen here. Every input is data already loaded by
 *     the caller; external evidence (does the storage object really exist,
 *     does the route really respond) is reconciled separately (Workstream
 *     7) and read back here as a stored PublicationArtifactValidation.
 *
 * No I/O. No Supabase.
 */

import type {
  ContentDeliverable,
  DeliverableVersion,
  PublicationArtifact,
  PublicationArtifactType,
  PublicationArtifactValidation,
} from "./types";
import { resolveRequirements, type RequirementKey } from "./publication-requirements";

export type ReadinessStatus = "pass" | "fail" | "not_required" | "unknown";

export interface ReadinessCheck {
  key: RequirementKey;
  label: string;
  status: ReadinessStatus;
  blocking: boolean;
  reason?: string;
  evidence?: {
    versionId?: string;
    artifactId?: string;
    storagePath?: string;
    publicUrl?: string;
  };
}

export interface DeliverableReadiness {
  deliverableId: string;
  currentVersionId: string | null;
  approvedVersionId: string | null;
  ready: boolean;
  excluded: boolean;
  checks: ReadinessCheck[];
  missingRequirements: string[];
  staleArtifacts: string[];
}

export interface EvaluateReadinessInput {
  deliverable: ContentDeliverable;
  currentVersion: DeliverableVersion | null;
  /** All publication_artifacts rows for this deliverable, any version. */
  artifacts: PublicationArtifact[];
  /** The most recent validation per artifact id, pre-resolved by the caller. */
  latestValidationByArtifactId: Record<string, PublicationArtifactValidation | undefined>;
}

const DEFAULT_LOCALE = "en-CA";

function findArtifact(
  artifacts: PublicationArtifact[],
  types: PublicationArtifactType[],
  currentVersionId: string | null,
  locale?: string | null,
): { current: PublicationArtifact | null; stale: PublicationArtifact | null } {
  const matching = artifacts
    .filter((a) => types.includes(a.artifact_type))
    .filter((a) => (locale ? a.locale === locale : true))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)); // newest first

  const current = matching.find((a) => a.version_id === currentVersionId) ?? null;
  const stale = current ? null : (matching[0] ?? null);
  return { current, stale };
}

function artifactPassed(
  artifact: PublicationArtifact | null,
  validations: Record<string, PublicationArtifactValidation | undefined>,
): boolean {
  if (!artifact) return false;
  const v = validations[artifact.id];
  return v?.result === "pass";
}

function evaluateOne(
  key: RequirementKey,
  input: EvaluateReadinessInput,
): Pick<ReadinessCheck, "status" | "reason" | "evidence"> {
  const { deliverable, currentVersion, artifacts, latestValidationByArtifactId } = input;
  const currentVersionId = deliverable.current_version_id;

  switch (key) {
    case "role_and_locale_known": {
      if (deliverable.deliverable_role && deliverable.locale) return { status: "pass" };
      return { status: "fail", reason: "deliverable_role or locale is not set on this deliverable" };
    }

    case "current_body": {
      if (!currentVersion) return { status: "fail", reason: "no current version exists" };
      if (deliverable.content_kind === "text") {
        return currentVersion.body_html && currentVersion.body_html.trim().length > 0
          ? { status: "pass" }
          : { status: "fail", reason: "current version has no body content" };
      }
      return currentVersion.storage_path
        ? { status: "pass", evidence: { storagePath: currentVersion.storage_path } }
        : { status: "fail", reason: "current version has no bound asset" };
    }

    case "current_version_approved": {
      if (!currentVersionId) return { status: "fail", reason: "no current version exists" };
      if (deliverable.approved_version_id === currentVersionId) {
        return { status: "pass", evidence: { versionId: currentVersionId } };
      }
      if (deliverable.approved_version_id) {
        return {
          status: "fail",
          reason: `approved version is not the current version (approved v${deliverable.approved_version_id}, current v${currentVersionId})`,
        };
      }
      return { status: "fail", reason: "the current version has not been formally approved by legal counsel" };
    }

    case "hero_image":
    case "campaign_image": {
      const types: PublicationArtifactType[] = ["hero_image", "social_image"];
      const { current, stale } = findArtifact(artifacts, types, currentVersionId);
      if (current) {
        return { status: "pass", evidence: { artifactId: current.id, storagePath: current.storage_path ?? undefined } };
      }
      if (stale) {
        return {
          status: "fail",
          reason: `an image exists for an earlier version (v${stale.version_id}) but not the current version`,
          evidence: { versionId: stale.version_id, artifactId: stale.id },
        };
      }
      return { status: "fail", reason: "no image is registered for the current version" };
    }

    case "webpage_artifact": {
      const { current, stale } = findArtifact(artifacts, ["webpage"], currentVersionId);
      if (current) return { status: "pass", evidence: { artifactId: current.id, publicUrl: current.public_url ?? undefined } };
      if (stale) {
        return {
          status: "fail",
          reason: `a webpage artifact exists for an earlier version (v${stale.version_id}) but not the current version`,
          evidence: { versionId: stale.version_id, artifactId: stale.id },
        };
      }
      return { status: "fail", reason: "the current version has not been deployed as a webpage" };
    }

    case "webpage_validated": {
      const { current } = findArtifact(artifacts, ["webpage"], currentVersionId);
      if (!current) return { status: "fail", reason: "no webpage artifact to validate" };
      return artifactPassed(current, latestValidationByArtifactId)
        ? { status: "pass", evidence: { artifactId: current.id } }
        : { status: "fail", reason: "the deployed webpage has not passed reconciliation validation" };
    }

    case "localized_route": {
      const locale = deliverable.locale ?? DEFAULT_LOCALE;
      const { current, stale } = findArtifact(artifacts, ["webpage"], currentVersionId, locale);
      if (current) return { status: "pass", evidence: { artifactId: current.id, publicUrl: current.public_url ?? undefined } };
      if (stale) {
        return {
          status: "fail",
          reason: `a ${locale} route exists for an earlier version, not the current one`,
          evidence: { versionId: stale.version_id, artifactId: stale.id },
        };
      }
      return { status: "fail", reason: `${locale} content exists, but the localized webpage artifact is missing` };
    }

    case "publication_destination_set": {
      return deliverable.publication_destination && deliverable.publication_path
        ? { status: "pass" }
        : { status: "fail", reason: "publication destination or path is not set" };
    }

    case "pdf_artifact": {
      if (currentVersion?.asset_sha256 && currentVersion.storage_path) {
        return { status: "pass", evidence: { versionId: currentVersionId ?? undefined, storagePath: currentVersion.storage_path } };
      }
      const { current, stale } = findArtifact(artifacts, ["pdf"], currentVersionId);
      if (current) return { status: "pass", evidence: { artifactId: current.id, storagePath: current.storage_path ?? undefined } };
      if (stale) {
        return {
          status: "fail",
          reason: `a PDF exists for version ${stale.version_id}, but the current approved version is ${currentVersionId}. Regenerate and reapprove the PDF before publishing.`,
          evidence: { versionId: stale.version_id, artifactId: stale.id },
        };
      }
      return { status: "fail", reason: "no PDF is bound to the current version" };
    }

    case "pdf_bytes_bound": {
      if (currentVersion?.asset_sha256 && currentVersion.asset_size_bytes != null && currentVersion.asset_mime) {
        return { status: "pass" };
      }
      const { current } = findArtifact(artifacts, ["pdf"], currentVersionId);
      if (current?.sha256 && current.size_bytes != null && current.mime_type) return { status: "pass", evidence: { artifactId: current.id } };
      return { status: "fail", reason: "PDF is missing SHA-256, size, or MIME type" };
    }

    case "pdf_validated": {
      if (currentVersion?.asset_validation) return { status: "pass" };
      const { current } = findArtifact(artifacts, ["pdf"], currentVersionId);
      if (current && artifactPassed(current, latestValidationByArtifactId)) return { status: "pass", evidence: { artifactId: current.id } };
      return { status: "fail", reason: "PDF has not passed its accessibility/technical validation" };
    }

    case "landing_page_placement": {
      return deliverable.publication_path
        ? { status: "pass" }
        : { status: "fail", reason: "no landing page placement is recorded for this file" };
    }

    case "form_present": {
      const { current } = findArtifact(artifacts, ["form"], currentVersionId);
      return current ? { status: "pass", evidence: { artifactId: current.id } } : { status: "fail", reason: "no form is registered for the current version" };
    }

    case "delivery_email_present": {
      const { current } = findArtifact(artifacts, ["email"], currentVersionId);
      return current ? { status: "pass", evidence: { artifactId: current.id } } : { status: "fail", reason: "no delivery email is registered for the current version" };
    }

    case "thank_you_page_present": {
      const { current } = findArtifact(artifacts, ["thank_you_page"], currentVersionId);
      return current ? { status: "pass", evidence: { artifactId: current.id } } : { status: "fail", reason: "no thank-you experience is registered for the current version" };
    }

    case "journey_validated": {
      const parts: PublicationArtifactType[] = ["webpage", "form", "email", "thank_you_page"];
      const missing: string[] = [];
      const unvalidated: string[] = [];
      for (const type of parts) {
        const { current } = findArtifact(artifacts, [type], currentVersionId);
        if (!current) missing.push(type);
        else if (!artifactPassed(current, latestValidationByArtifactId)) unvalidated.push(type);
      }
      if (missing.length > 0) return { status: "fail", reason: `journey is incomplete, missing: ${missing.join(", ")}` };
      if (unvalidated.length > 0) return { status: "fail", reason: `not yet validated: ${unvalidated.join(", ")}` };
      return { status: "pass" };
    }

    case "destination_configuration": {
      return deliverable.publication_destination ? { status: "pass" } : { status: "fail", reason: "no publication destination is configured" };
    }

    case "publish_schedule_set": {
      return deliverable.publish_date ? { status: "pass" } : { status: "fail", reason: "no publish date or schedule is set" };
    }

    default:
      return { status: "unknown", reason: `no evaluator implemented for requirement "${key}"` };
  }
}

/**
 * Evaluates one deliverable's full readiness. Never throws on missing or
 * malformed data; every failure mode resolves to a "fail" or "unknown"
 * check rather than an exception, so a caller can render a full week of
 * rows even when several are incomplete.
 */
export function evaluateDeliverableReadiness(input: EvaluateReadinessInput): DeliverableReadiness {
  const { deliverable, artifacts } = input;

  if (deliverable.status === "archived") {
    return {
      deliverableId: deliverable.id,
      currentVersionId: deliverable.current_version_id,
      approvedVersionId: deliverable.approved_version_id,
      ready: false,
      excluded: true,
      checks: [],
      missingRequirements: [],
      staleArtifacts: [],
    };
  }

  const requirements = resolveRequirements(deliverable);
  const checks: ReadinessCheck[] = requirements.map((spec) => {
    if (!spec.blocking) {
      return { key: spec.key, label: spec.label, status: "not_required", blocking: false };
    }
    const result = evaluateOne(spec.key, input);
    return { key: spec.key, label: spec.label, status: result.status, blocking: true, reason: result.reason, evidence: result.evidence };
  });

  const missingRequirements = checks.filter((c) => c.blocking && c.status !== "pass").map((c) => c.key);
  const staleArtifacts = checks.filter((c) => c.blocking && c.status === "fail" && c.evidence?.versionId).map((c) => c.key);
  const ready = checks.every((c) => !c.blocking || c.status === "pass");

  return {
    deliverableId: deliverable.id,
    currentVersionId: deliverable.current_version_id,
    approvedVersionId: deliverable.approved_version_id,
    ready,
    excluded: false,
    checks,
    missingRequirements,
    staleArtifacts,
  };
}

export interface ReadinessSummaryCounts {
  active: number;
  ready: number;
  blocked: number;
  excluded: number;
}

/**
 * Pure count rollup over an already-evaluated set of readiness rows. Used
 * both for a whole plan (evaluatePeriodReadiness, below) and for a single
 * period/week slice of that same set (the UI filters `items` down to one
 * period's deliverables, then calls this directly rather than
 * re-evaluating), so the two summaries can never drift out of sync with
 * each other's counting rules.
 */
export function summarizeReadiness(items: DeliverableReadiness[]): ReadinessSummaryCounts {
  const active = items.filter((i) => !i.excluded);
  return {
    active: active.length,
    ready: active.filter((i) => i.ready).length,
    blocked: active.filter((i) => !i.ready).length,
    excluded: items.filter((i) => i.excluded).length,
  };
}

/** Convenience for a whole period/week: readiness per deliverable + counts. */
export function evaluatePeriodReadiness(inputs: EvaluateReadinessInput[]): {
  items: DeliverableReadiness[];
  summary: ReadinessSummaryCounts;
} {
  const items = inputs.map(evaluateDeliverableReadiness);
  return { items, summary: summarizeReadiness(items) };
}

/**
 * Slices an already-evaluated whole-plan readiness set down to one period's
 * own deliverables, recomputing the summary counts for just that slice. This
 * is what lets the per-week UI card show a real, period-scoped readiness
 * summary (and, critically, a working "download manifest" link for that
 * exact period) without a second data load: the whole-plan set is evaluated
 * once, and each period's card gets its own slice of the same result.
 */
export function sliceReadinessForPeriod(
  items: DeliverableReadiness[],
  periodDeliverableIds: Set<string>,
): { items: DeliverableReadiness[]; summary: ReadinessSummaryCounts } {
  const sliced = items.filter((r) => periodDeliverableIds.has(r.deliverableId));
  return { items: sliced, summary: summarizeReadiness(sliced) };
}

/**
 * Publication Readiness remediation (DR-097, revised after review): the
 * display states a lawyer or operator actually needs to distinguish,
 * layered on top of the raw pass/fail evaluation above. The raw evaluator
 * (evaluateDeliverableReadiness) stays unconditional and always correct;
 * a period's EXPLICIT lifecycle classification (never a date, never a
 * nullable-timestamp proxy) changes how that raw result is DISPLAYED,
 * never how it is computed.
 *
 * PeriodLifecycle mirrors content_periods.readiness_lifecycle exactly
 * (see 20260715120000_content_periods_readiness_activation.sql):
 *   - legacy_unreconciled: pre-existing content, explicitly classified as
 *     predating the readiness ledger. Every active deliverable renders
 *     "Historical, not reconciled" regardless of metadata completeness.
 *   - setup_required: the default for every period that is not explicitly
 *     legacy -- current work, future work, and stalled/unapproved
 *     backlogs alike. Every active deliverable renders "Setup required"
 *     until the period is activated, even one whose own metadata is
 *     already fully backfilled (that deliverable is ready FOR
 *     ACTIVATION, not yet "ready" in the enforced sense).
 *   - enforced: the activation preflight passed (and the database
 *     confirmed it atomically). Only now does a deliverable's raw
 *     ready/blocked result drive its display state.
 *
 * A first draft of this model derived display state from a single
 * nullable readiness_enforced_at timestamp ("null = historical"), which
 * wrongly labelled the CURRENT publishing period (Founder Vesting,
 * already fully metadata-complete) as historical. This revision fixes
 * that by keying off the explicit lifecycle column instead.
 */
export type PeriodLifecycle = "legacy_unreconciled" | "setup_required" | "enforced";

export type PeriodReadinessState =
  | "historical_unreconciled"
  | "setup_required"
  | "blocked"
  | "ready"
  | "excluded";

/**
 * The requirement keys that represent "this hasn't been configured yet"
 * rather than "something is genuinely wrong": unset deliverable_role/
 * locale (role_and_locale_known), an unset publication destination/path
 * for an article (publication_destination_set), or an unset placement for
 * a lead-magnet PDF (landing_page_placement). A deliverable failing ONLY
 * these is "setup_required" once its period is enforced, never a red
 * "blocked": that label is reserved for a deliverable that IS configured
 * but still fails a real production requirement (missing image, missing
 * approval, stale artifact, unvalidated route, etc). This set matches
 * exactly what the database activation trigger requires
 * (trg_validate_readiness_activation) -- see the role-aware placement
 * note there: gbp_post/social_post deliverables have no placement concept
 * of their own (cta_target_path is descriptive only, never a requirement),
 * so no requirement key for them appears here.
 */
const METADATA_ONLY_KEYS = new Set<RequirementKey>([
  "role_and_locale_known",
  "publication_destination_set",
  "landing_page_placement",
]);

/**
 * Derives the display state for one deliverable's already-evaluated
 * readiness, given its period's EXPLICIT lifecycle classification. Pure:
 * periodLifecycle is resolved once by the caller from
 * content_periods.readiness_lifecycle (or "setup_required" when the
 * deliverable has no period_id at all: unscheduled content was never
 * activated for readiness either, and is not legacy either, so it gets
 * the same "needs setup" treatment as a brand-new period rather than a
 * spurious red Blocked or a spurious Historical label).
 */
export function deriveDisplayState(
  item: DeliverableReadiness,
  periodLifecycle: PeriodLifecycle,
): PeriodReadinessState {
  if (item.excluded) return "excluded";
  if (periodLifecycle === "legacy_unreconciled") return "historical_unreconciled";
  if (periodLifecycle === "setup_required") return "setup_required";
  // periodLifecycle === "enforced": the database guarantees metadata is
  // complete for every active deliverable at the moment of activation, so
  // a metadata-only failure here would mean something changed after the
  // fact in a way the triggers should have refused. Fail calm, not
  // alarming, as a defense-in-depth signal rather than a false "blocked".
  if (item.ready) return "ready";
  const nonMetadataFailures = item.missingRequirements.filter(
    (k) => !METADATA_ONLY_KEYS.has(k as RequirementKey),
  );
  return nonMetadataFailures.length === 0 ? "setup_required" : "blocked";
}

export interface DisplayStateCounts {
  historicalUnreconciled: number;
  setupRequired: number;
  blocked: number;
  ready: number;
  excluded: number;
}

/** Same rollup shape as summarizeReadiness, but over display states. */
export function summarizeDisplayStates(
  items: DeliverableReadiness[],
  periodLifecycle: PeriodLifecycle,
): DisplayStateCounts {
  const counts: DisplayStateCounts = {
    historicalUnreconciled: 0,
    setupRequired: 0,
    blocked: 0,
    ready: 0,
    excluded: 0,
  };
  for (const item of items) {
    switch (deriveDisplayState(item, periodLifecycle)) {
      case "excluded":
        counts.excluded++;
        break;
      case "historical_unreconciled":
        counts.historicalUnreconciled++;
        break;
      case "setup_required":
        counts.setupRequired++;
        break;
      case "blocked":
        counts.blocked++;
        break;
      case "ready":
        counts.ready++;
        break;
    }
  }
  return counts;
}

export interface PeriodActivationCheck {
  canActivate: boolean;
  /** Active (non-archived) deliverable ids still missing role/locale/destination/placement. */
  blockingDeliverableIds: string[];
}

/**
 * The activation preflight (DR-097): a period's readiness_lifecycle may
 * only transition to "enforced" once every ACTIVE deliverable in it has
 * role, locale, destination, and (where the role has one) placement set.
 * Reuses the same raw evaluateDeliverableReadiness output a not-yet-
 * enforced period already has available: metadata completeness is
 * checkable before enforcement exists, by design, so a period can be
 * validated before it is flipped on. Archived deliverables are exempt,
 * matching evaluateDeliverableReadiness's own exclusion. This is an
 * application-level PRE-check for a fast, itemized error message; the
 * database trigger trg_validate_readiness_activation
 * (20260715120000_content_periods_readiness_activation.sql) is the
 * authoritative, atomic enforcement -- this function must stay a subset
 * of what that trigger allows, never a looser gate.
 */
export function evaluateActivationPreflight(
  items: DeliverableReadiness[],
): PeriodActivationCheck {
  const active = items.filter((i) => !i.excluded);
  const incomplete = active.filter((i) =>
    i.missingRequirements.some((k) => METADATA_ONLY_KEYS.has(k as RequirementKey)),
  );
  return {
    canActivate: incomplete.length === 0,
    blockingDeliverableIds: incomplete.map((i) => i.deliverableId),
  };
}
