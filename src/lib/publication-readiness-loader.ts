/**
 * Publication Readiness, Workstream 5: whole-plan I/O loader.
 *
 * Assembles the same joins buildPublicationManifest (Workstream 6, in
 * publication-manifest.ts) uses, but scoped to a whole firm's live content
 * plan rather than a single period, so the ReviewOverview panel can show one
 * readiness summary across every week. Stays a thin I/O wrapper: all
 * evaluation logic lives in evaluatePeriodReadiness (publication-readiness.ts).
 *
 * Additive and non-blocking by design: loadPlanPublicationReadiness never
 * throws. Any Supabase error or unexpected exception resolves to
 * EMPTY_PLAN_READINESS so a failure here can never break the deliverables
 * page that already renders without this data.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  evaluatePeriodReadiness,
  evaluateDeliverableReadiness,
  type DeliverableReadiness,
  type EvaluateReadinessInput,
  type PeriodLifecycle,
} from "@/lib/publication-readiness";
import type {
  ContentDeliverable,
  DeliverableVersion,
  PublicationArtifact,
  PublicationArtifactValidation,
} from "@/lib/types";

/**
 * Bundles the evaluatePeriodReadiness result with the title lookup the UI
 * needs. Deliberately NOT named the same as PublicationReadinessSummary's
 * PlanPublicationReadiness prop type (summary + items only): this adds
 * titles, and the two shapes are consumed differently by the caller.
 */
export interface PlanPublicationReadinessResult {
  summary: { active: number; ready: number; blocked: number; excluded: number };
  items: DeliverableReadiness[];
  /** Deliverable id to title, for surfaces that only have the readiness rows. */
  titles: Record<string, string>;
  /**
   * DR-097: per-deliverable period LIFECYCLE, keyed by deliverable id.
   * "setup_required" when the deliverable has no period_id at all
   * (unscheduled content is not legacy and not enforced either -- it just
   * needs setup, the same as a brand-new period). The whole-plan summary
   * mixes deliverables from many periods at once, so it needs this
   * per-deliverable, not a single period-level value like the per-period
   * card does.
   */
  lifecycleByDeliverableId: Record<string, PeriodLifecycle>;
}

const EMPTY_PLAN_READINESS: PlanPublicationReadinessResult = {
  summary: { active: 0, ready: 0, blocked: 0, excluded: 0 },
  items: [],
  titles: {},
  lifecycleByDeliverableId: {},
};

/**
 * Whole-plan readiness for one firm. Includes every content_deliverables row
 * for the firm regardless of period placement or archived status: archived
 * rows resolve to "excluded" inside the evaluator itself, so no separate
 * archived filter is needed here.
 */
export async function loadPlanPublicationReadiness(firmId: string): Promise<PlanPublicationReadinessResult> {
  try {
    const { data: deliverables, error: delErr } = await supabase
      .from("content_deliverables")
      .select("*")
      .eq("firm_id", firmId);
    if (delErr || !deliverables) return EMPTY_PLAN_READINESS;

    const rows = deliverables as ContentDeliverable[];
    if (rows.length === 0) return EMPTY_PLAN_READINESS;

    const versionIds = rows.map((d) => d.current_version_id).filter((id): id is string => !!id);
    const { data: versions, error: verErr } = versionIds.length
      ? await supabase.from("deliverable_versions").select("*").in("id", versionIds)
      : { data: [] as DeliverableVersion[], error: null };
    if (verErr) return EMPTY_PLAN_READINESS;
    const versionById = new Map((versions ?? []).map((v) => [v.id, v as DeliverableVersion]));

    const deliverableIds = rows.map((d) => d.id);
    const { data: artifacts, error: artErr } = deliverableIds.length
      ? await supabase.from("publication_artifacts").select("*").in("deliverable_id", deliverableIds)
      : { data: [] as PublicationArtifact[], error: null };
    if (artErr) return EMPTY_PLAN_READINESS;
    const allArtifacts = (artifacts ?? []) as PublicationArtifact[];

    const artifactIds = allArtifacts.map((a) => a.id);
    const { data: validations, error: valErr } = artifactIds.length
      ? await supabase
          .from("publication_artifact_validations")
          .select("*")
          .in("artifact_id", artifactIds)
          .order("created_at", { ascending: false })
      : { data: [] as PublicationArtifactValidation[], error: null };
    if (valErr) return EMPTY_PLAN_READINESS;
    const latestValidationByArtifactId: Record<string, PublicationArtifactValidation | undefined> = {};
    for (const v of (validations ?? []) as PublicationArtifactValidation[]) {
      if (!latestValidationByArtifactId[v.artifact_id]) latestValidationByArtifactId[v.artifact_id] = v;
    }

    const periodIds = [...new Set(rows.map((d) => d.period_id).filter((id): id is string => !!id))];
    const { data: periods, error: periodErr } = periodIds.length
      ? await supabase.from("content_periods").select("id, readiness_lifecycle").in("id", periodIds)
      : { data: [] as { id: string; readiness_lifecycle: PeriodLifecycle }[], error: null };
    if (periodErr) return EMPTY_PLAN_READINESS;
    const lifecycleByPeriodId = new Map(
      (periods ?? []).map((p) => [p.id, p.readiness_lifecycle]),
    );
    const lifecycleByDeliverableId: Record<string, PeriodLifecycle> = {};
    for (const d of rows) {
      lifecycleByDeliverableId[d.id] = d.period_id
        ? (lifecycleByPeriodId.get(d.period_id) ?? "setup_required")
        : "setup_required";
    }

    const inputs: EvaluateReadinessInput[] = rows.map((deliverable) => ({
      deliverable,
      currentVersion: deliverable.current_version_id
        ? (versionById.get(deliverable.current_version_id) ?? null)
        : null,
      artifacts: allArtifacts.filter((a) => a.deliverable_id === deliverable.id),
      latestValidationByArtifactId,
    }));

    const { items, summary } = evaluatePeriodReadiness(inputs);
    const titles: Record<string, string> = {};
    for (const d of rows) titles[d.id] = d.title;

    return { items, summary, titles, lifecycleByDeliverableId };
  } catch {
    return EMPTY_PLAN_READINESS;
  }
}

/**
 * Period-scoped readiness (DR-097 activation preflight). A narrow sibling
 * to loadPlanPublicationReadiness, scoped to one period rather than the
 * whole firm. Used only by the activation preflight (activatePeriodReadiness
 * in lib/deliverables.ts); the UI's per-period slice still comes from
 * slicing the whole-plan result (sliceReadinessForPeriod), so this stays a
 * preflight-only helper rather than a second rendering data path.
 */
export async function loadPeriodPublicationReadiness(
  periodId: string,
  firmId: string,
): Promise<DeliverableReadiness[]> {
  try {
    const { data: deliverables, error: delErr } = await supabase
      .from("content_deliverables")
      .select("*")
      .eq("period_id", periodId)
      .eq("firm_id", firmId);
    if (delErr || !deliverables) return [];

    const rows = deliverables as ContentDeliverable[];
    if (rows.length === 0) return [];

    const versionIds = rows.map((d) => d.current_version_id).filter((id): id is string => !!id);
    const { data: versions, error: verErr } = versionIds.length
      ? await supabase.from("deliverable_versions").select("*").in("id", versionIds)
      : { data: [] as DeliverableVersion[], error: null };
    if (verErr) return [];
    const versionById = new Map((versions ?? []).map((v) => [v.id, v as DeliverableVersion]));

    const deliverableIds = rows.map((d) => d.id);
    const { data: artifacts, error: artErr } = deliverableIds.length
      ? await supabase.from("publication_artifacts").select("*").in("deliverable_id", deliverableIds)
      : { data: [] as PublicationArtifact[], error: null };
    if (artErr) return [];
    const allArtifacts = (artifacts ?? []) as PublicationArtifact[];

    const artifactIds = allArtifacts.map((a) => a.id);
    const { data: validations, error: valErr } = artifactIds.length
      ? await supabase
          .from("publication_artifact_validations")
          .select("*")
          .in("artifact_id", artifactIds)
          .order("created_at", { ascending: false })
      : { data: [] as PublicationArtifactValidation[], error: null };
    if (valErr) return [];
    const latestValidationByArtifactId: Record<string, PublicationArtifactValidation | undefined> = {};
    for (const v of (validations ?? []) as PublicationArtifactValidation[]) {
      if (!latestValidationByArtifactId[v.artifact_id]) latestValidationByArtifactId[v.artifact_id] = v;
    }

    const inputs: EvaluateReadinessInput[] = rows.map((deliverable) => ({
      deliverable,
      currentVersion: deliverable.current_version_id
        ? (versionById.get(deliverable.current_version_id) ?? null)
        : null,
      artifacts: allArtifacts.filter((a) => a.deliverable_id === deliverable.id),
      latestValidationByArtifactId,
    }));

    return inputs.map(evaluateDeliverableReadiness);
  } catch {
    return [];
  }
}
