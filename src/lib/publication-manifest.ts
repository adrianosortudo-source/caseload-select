/**
 * Publication Readiness, Workstream 6: the read-only release manifest.
 *
 * Loads a period's deliverables, their current versions, and every
 * registered publication_artifacts row, evaluates readiness for each
 * (Workstream 4), and assembles the manifest object described in the
 * workstream spec. This module does the I/O; publication-readiness.ts
 * stays pure. No LLM call. No network calls beyond the Supabase reads
 * below. Deterministic apart from generated_at.
 */

import "server-only";
import { supabaseAdmin as supabase } from "./supabase-admin";
import {
  evaluateDeliverableReadiness,
  deriveDisplayState,
  summarizeDisplayStates,
  type DeliverableReadiness,
  type EvaluateReadinessInput,
  type PeriodReadinessState,
  type PeriodLifecycle,
  type DisplayStateCounts,
} from "./publication-readiness";
import { resolveRequirements } from "./publication-requirements";
import type {
  ContentDeliverable,
  DeliverableVersion,
  PublicationArtifact,
  PublicationArtifactValidation,
} from "./types";

export interface PublicationManifest {
  schema_version: "1.0";
  firm_id: string;
  period_id: string;
  period: {
    starts_on: string;
    ends_on: string;
    theme: string | null;
    /**
     * DR-097. Explicit lifecycle classification, mirroring
     * content_periods.readiness_lifecycle exactly (never derived from a
     * date). Unless this is "enforced", every deliverable's
     * `ready`/`missing_requirements` below are still the raw, unconditional
     * evaluation -- `display_state` (never the raw fields) is what a
     * consumer should render as this period's actual status, since raw
     * "blocked" is expected and non-alarming while the period is not yet
     * enforced.
     */
    lifecycle: PeriodLifecycle;
  };
  policy: {
    generation_policy: "existing_assets_only";
    may_generate_missing_assets: false;
    may_modify_copy: false;
    may_translate: false;
    may_publish_ready_items: false;
    requires_explicit_publication_authorization: true;
  };
  summary: {
    active_deliverables: number;
    ready: number;
    blocked: number;
    excluded_archived: number;
  };
  /** DR-097: the same rollup, but keyed by display_state, respecting period.lifecycle. */
  display_summary: DisplayStateCounts;
  deliverables: ManifestDeliverable[];
  excluded_deliverables: ManifestDeliverable[];
  generated_at: string;
  generated_by: { role: "operator"; id: string | null };
}

export interface ManifestDeliverable {
  deliverable_id: string;
  title: string;
  locale: string | null;
  deliverable_role: string | null;
  publication_destination: string | null;
  publication_path: string | null;
  current_version_id: string | null;
  current_version_number: number | null;
  approved_version_id: string | null;
  approved: boolean;
  copy_present: boolean;
  required_artifacts: string[];
  existing_artifacts: { artifact_type: string; artifact_id: string; version_id: string; public_url: string | null }[];
  stale_artifacts: string[];
  missing_requirements: string[];
  ready: boolean;
  /** DR-097: the state to actually render. See PublicationManifest.period.lifecycle. */
  display_state: PeriodReadinessState;
  permitted_actions: string[];
  prohibited_actions: string[];
}

const PROHIBITED_ACTIONS = [
  "generate_missing_asset",
  "rewrite_content",
  "translate_content",
  "publish",
  "schedule",
  "approve_on_behalf_of_lawyer",
];

const PERMITTED_ACTIONS_BASE = ["view_readiness", "reconcile_evidence", "download_manifest"];

const DISPLAY_STATE_LABEL: Record<PeriodReadinessState, string> = {
  historical_unreconciled: "Historical, not reconciled",
  setup_required: "Setup required",
  blocked: "Blocked",
  ready: "Ready",
  excluded: "Excluded (archived)",
};

function toManifestDeliverable(
  deliverable: ContentDeliverable,
  currentVersion: DeliverableVersion | null,
  readiness: DeliverableReadiness,
  artifacts: PublicationArtifact[],
  periodLifecycle: PeriodLifecycle,
): ManifestDeliverable {
  const currentArtifacts = artifacts.filter(
    (a) => a.deliverable_id === deliverable.id && a.version_id === deliverable.current_version_id,
  );
  return {
    deliverable_id: deliverable.id,
    title: deliverable.title,
    locale: deliverable.locale,
    deliverable_role: deliverable.deliverable_role,
    publication_destination: deliverable.publication_destination,
    publication_path: deliverable.publication_path,
    current_version_id: deliverable.current_version_id,
    current_version_number: currentVersion?.version_number ?? null,
    approved_version_id: deliverable.approved_version_id,
    approved: deliverable.approved_version_id === deliverable.current_version_id && deliverable.current_version_id !== null,
    copy_present: readiness.checks.find((c) => c.key === "current_body")?.status === "pass",
    required_artifacts: resolveRequirements(deliverable)
      .filter((r) => r.blocking)
      .map((r) => r.key),
    existing_artifacts: currentArtifacts.map((a) => ({
      artifact_type: a.artifact_type,
      artifact_id: a.id,
      version_id: a.version_id,
      public_url: a.public_url,
    })),
    stale_artifacts: readiness.staleArtifacts,
    missing_requirements: readiness.missingRequirements,
    ready: readiness.ready,
    display_state: deriveDisplayState(readiness, periodLifecycle),
    permitted_actions: PERMITTED_ACTIONS_BASE,
    prohibited_actions: PROHIBITED_ACTIONS,
  };
}

export async function buildPublicationManifest(
  periodId: string,
  generatedByOperatorId: string | null,
): Promise<{ ok: true; manifest: PublicationManifest } | { ok: false; error: string }> {
  const { data: period, error: periodErr } = await supabase
    .from("content_periods")
    .select("id, firm_id, starts_on, ends_on, theme, readiness_lifecycle")
    .eq("id", periodId)
    .maybeSingle();
  if (periodErr) return { ok: false, error: periodErr.message };
  if (!period) return { ok: false, error: "period not found" };
  const periodLifecycle = period.readiness_lifecycle as PeriodLifecycle;

  const { data: deliverables, error: delErr } = await supabase
    .from("content_deliverables")
    .select("*")
    .eq("period_id", periodId);
  if (delErr) return { ok: false, error: delErr.message };
  const rows = (deliverables ?? []) as ContentDeliverable[];

  const versionIds = rows.map((d) => d.current_version_id).filter((id): id is string => !!id);
  const { data: versions, error: verErr } = versionIds.length
    ? await supabase.from("deliverable_versions").select("*").in("id", versionIds)
    : { data: [] as DeliverableVersion[], error: null };
  if (verErr) return { ok: false, error: verErr.message };
  const versionById = new Map((versions ?? []).map((v) => [v.id, v as DeliverableVersion]));

  const deliverableIds = rows.map((d) => d.id);
  const { data: artifacts, error: artErr } = deliverableIds.length
    ? await supabase.from("publication_artifacts").select("*").in("deliverable_id", deliverableIds)
    : { data: [] as PublicationArtifact[], error: null };
  if (artErr) return { ok: false, error: artErr.message };
  const allArtifacts = (artifacts ?? []) as PublicationArtifact[];

  const artifactIds = allArtifacts.map((a) => a.id);
  const { data: validations, error: valErr } = artifactIds.length
    ? await supabase
        .from("publication_artifact_validations")
        .select("*")
        .in("artifact_id", artifactIds)
        .order("created_at", { ascending: false })
    : { data: [] as PublicationArtifactValidation[], error: null };
  if (valErr) return { ok: false, error: valErr.message };
  const latestValidationByArtifactId: Record<string, PublicationArtifactValidation | undefined> = {};
  for (const v of (validations ?? []) as PublicationArtifactValidation[]) {
    if (!latestValidationByArtifactId[v.artifact_id]) latestValidationByArtifactId[v.artifact_id] = v;
  }

  const included: ManifestDeliverable[] = [];
  const excluded: ManifestDeliverable[] = [];
  const allReadiness: DeliverableReadiness[] = [];

  for (const deliverable of rows) {
    const currentVersion = deliverable.current_version_id ? (versionById.get(deliverable.current_version_id) ?? null) : null;
    const input: EvaluateReadinessInput = {
      deliverable,
      currentVersion,
      artifacts: allArtifacts.filter((a) => a.deliverable_id === deliverable.id),
      latestValidationByArtifactId,
    };
    const readiness = evaluateDeliverableReadiness(input);
    allReadiness.push(readiness);
    const manifestRow = toManifestDeliverable(deliverable, currentVersion, readiness, allArtifacts, periodLifecycle);
    if (readiness.excluded) excluded.push(manifestRow);
    else included.push(manifestRow);
  }

  const manifest: PublicationManifest = {
    schema_version: "1.0",
    firm_id: period.firm_id,
    period_id: period.id,
    period: {
      starts_on: period.starts_on,
      ends_on: period.ends_on,
      theme: period.theme,
      lifecycle: periodLifecycle,
    },
    policy: {
      generation_policy: "existing_assets_only",
      may_generate_missing_assets: false,
      may_modify_copy: false,
      may_translate: false,
      may_publish_ready_items: false,
      requires_explicit_publication_authorization: true,
    },
    summary: {
      active_deliverables: included.length,
      ready: included.filter((d) => d.ready).length,
      blocked: included.filter((d) => !d.ready).length,
      excluded_archived: excluded.length,
    },
    display_summary: summarizeDisplayStates(allReadiness, periodLifecycle),
    deliverables: included,
    excluded_deliverables: excluded,
    generated_at: new Date().toISOString(),
    generated_by: { role: "operator", id: generatedByOperatorId },
  };

  return { ok: true, manifest };
}

/** Markdown rendering of the same manifest object. Never a second source of truth. */
export function renderManifestMarkdown(manifest: PublicationManifest): string {
  const lines: string[] = [];
  lines.push(`# Publication manifest — ${manifest.period.theme ?? manifest.period_id}`);
  lines.push("");
  lines.push(`Period: ${manifest.period.starts_on} to ${manifest.period.ends_on}`);
  lines.push(`Generated: ${manifest.generated_at}`);
  lines.push("");
  lines.push("## AI operator instructions");
  lines.push("");
  lines.push("- Do not generate.");
  lines.push("- Do not modify copy.");
  lines.push("- Do not translate.");
  lines.push("- Do not publish.");
  lines.push("- Report missing requirements.");
  lines.push("- Wait for explicit authorization.");
  lines.push("");
  if (manifest.period.lifecycle === "legacy_unreconciled") {
    lines.push("## Legacy period: not reconciled");
    lines.push(
      "This period was explicitly classified as pre-existing content that predates the readiness ledger. The raw ready/blocked counts below reflect the unconditional requirement checks, not action-required blockers: a deliverable missing only metadata here is historical, not genuinely blocked. See each item's Status line, not the raw Ready field.",
    );
    lines.push("");
  } else if (manifest.period.lifecycle === "setup_required") {
    lines.push("## Not yet activated: setup required");
    lines.push(
      "This period has not passed the activation preflight (or has not been submitted for activation). The raw ready/blocked counts below reflect the unconditional requirement checks, not action-required blockers: nothing here is genuinely \"Blocked\" until the period is activated. See each item's Status line, not the raw Ready field.",
    );
    lines.push("");
  }
  lines.push(
    `## Summary: ${manifest.summary.active_deliverables} active, ${manifest.summary.ready} ready, ${manifest.summary.blocked} blocked, ${manifest.summary.excluded_archived} excluded (archived)`,
  );
  lines.push(
    `## Status: ${manifest.display_summary.ready} ready, ${manifest.display_summary.blocked} blocked, ${manifest.display_summary.setupRequired} setup required, ${manifest.display_summary.historicalUnreconciled} historical (not reconciled), ${manifest.display_summary.excluded} excluded`,
  );
  lines.push("");
  for (const d of manifest.deliverables) {
    lines.push(`### ${d.title}`);
    lines.push(`- Role: ${d.deliverable_role ?? "unknown"} · Locale: ${d.locale ?? "unknown"} · Destination: ${d.publication_destination ?? "unknown"}`);
    lines.push(`- Status: ${DISPLAY_STATE_LABEL[d.display_state]}`);
    if (d.display_state === "blocked" || d.display_state === "setup_required") {
      lines.push(`- Missing: ${d.missing_requirements.join(", ") || "none listed"}`);
    }
    if (d.stale_artifacts.length) lines.push(`- Stale evidence: ${d.stale_artifacts.join(", ")}`);
    lines.push("");
  }
  if (manifest.excluded_deliverables.length) {
    lines.push("## Excluded (archived)");
    for (const d of manifest.excluded_deliverables) lines.push(`- ${d.title}`);
  }
  return lines.join("\n");
}
