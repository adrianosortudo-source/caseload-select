/**
 * Publication Operator, Workstream 1: I/O loader for
 * PublicationExecutionManifest. Assembles stored, immutable records only --
 * a request body may supply identifiers (firmId, placementId) but nothing
 * else this loader returns. Mirrors the existing codebase's own thin-loader
 * convention (see publication-preflight-loader.ts): every branching
 * decision lives in the pure builder (publication-execution-manifest.ts),
 * this file only fetches and shapes rows for it.
 *
 * Two-phase fetch (corrective pass, post-review): phase 1 loads everything
 * needed to DECIDE which version would actually release (resolveReleaseVersion
 * needs both approvedVersion and currentVersion plus standing-authorization
 * state); phase 2, run only after that decision, scopes the receipt lookup
 * to the exact resolved release version rather than hardcoding
 * approved_version_id, so a standing-authorization placement's prior receipt
 * (bound to current_version_id) is found correctly.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { resolveFirmTimezone } from "@/lib/firm-timezone";
import { getStandingAuthorizationState } from "@/lib/standing-publishing-authorization";
import { getCurrentReceiptForPlacement } from "@/lib/publication-receipts";
import { getLatestClaimForPlacement } from "@/lib/publication-placement-claims";
import {
  buildPublicationExecutionManifest,
  resolveReleaseVersion,
  type PublicationExecutionManifest,
  type ManifestGeneratorIdentity,
} from "@/lib/publication-execution-manifest";
import type {
  ContentDeliverable,
  ContentPeriod,
  ContentPlacement,
  DeliverableVersion,
  PublicationArtifact,
  PlacementDestination,
} from "@/lib/types";

/**
 * The operator's explicit, current publishing-account configuration for
 * this firm and destination (publication_destination_configs -- corrective-
 * pass addition, migration authored but NOT YET APPLIED anywhere; see
 * supabase/migrations/20260718121500_publication_destination_configs.sql).
 * Deploy-safety guarded exactly like getFirmAbout/resolveEmailBranding
 * elsewhere in this codebase: the table does not exist in any environment
 * yet, so this query is expected to error until the migration is reviewed
 * and applied, and that error is swallowed as "no explicit configuration
 * exists" -- the same fallback behavior the loader already had before this
 * table existed. Never throws.
 */
async function resolveExplicitDestinationConfig(
  firmId: string,
  destination: PlacementDestination,
): Promise<{ identifier: string; label: string | null } | null> {
  try {
    const { data, error } = await supabase
      .from("publication_destination_configs")
      .select("identifier, label")
      .eq("firm_id", firmId)
      .eq("destination", destination)
      .eq("active", true)
      .order("config_seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { identifier: string; label: string | null };
    return { identifier: row.identifier, label: row.label ?? null };
  } catch {
    return null;
  }
}

/**
 * Resolves the firm's real, VALIDATED website base URL from existing
 * evidence only -- the most recent 'webpage' publication_artifacts row (of
 * a bounded recent set) that has at least one passing
 * publication_artifact_validations record, or failing that the most recent
 * verified firm_website receipt (receipts are already validation-gated by
 * their own verification_state). Never guesses, never hardcodes a per-firm
 * domain, and never trusts a merely-REGISTERED artifact whose evidence was
 * never actually checked -- registration is an operator's claim; validation
 * is proof the claim was verified (corrective-pass fix: the prior version
 * of this function trusted the latest registered artifact unconditionally).
 *
 * This is destination-agnostic by design: it always resolves the firm's
 * WEBSITE identity, independent of which destination the current placement
 * targets, because a GBP/LinkedIn post's CTA points at the website
 * regardless of where the post itself publishes.
 */
async function resolveValidatedWebsiteBaseUrl(firmId: string): Promise<string | null> {
  const { data: artifactRows } = await supabase
    .from("publication_artifacts")
    .select("id, public_url, created_at")
    .eq("firm_id", firmId)
    .eq("artifact_type", "webpage")
    .not("public_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);

  const candidates = (artifactRows ?? []) as Array<{ id: string; public_url: string; created_at: string }>;
  if (candidates.length > 0) {
    const { data: validations } = await supabase
      .from("publication_artifact_validations")
      .select("artifact_id, result")
      .in(
        "artifact_id",
        candidates.map((c) => c.id),
      )
      .eq("result", "pass");
    const validatedIds = new Set(((validations ?? []) as Array<{ artifact_id: string }>).map((v) => v.artifact_id));
    const validated = candidates.find((c) => validatedIds.has(c.id));
    if (validated) {
      try {
        return new URL(validated.public_url).origin;
      } catch {
        // fall through to receipts
      }
    }
  }

  const { data: receiptRows } = await supabase
    .from("publication_receipts")
    .select("public_url, published_at")
    .eq("firm_id", firmId)
    .eq("destination", "firm_website")
    .eq("verification_state", "verified")
    .not("public_url", "is", null)
    .order("published_at", { ascending: false })
    .limit(1);

  const receiptUrl = (receiptRows?.[0] as { public_url: string | null } | undefined)?.public_url ?? null;
  if (!receiptUrl) return null;
  try {
    return new URL(receiptUrl).origin;
  } catch {
    return null;
  }
}

export interface LoadManifestResult {
  ok: true;
  manifest: PublicationExecutionManifest;
}
export interface LoadManifestFailure {
  ok: false;
  error: string;
  status: 404 | 422;
}

export async function loadPublicationExecutionManifest(
  firmId: string,
  placementId: string,
  generatedBy: ManifestGeneratorIdentity,
): Promise<LoadManifestResult | LoadManifestFailure> {
  const { data: placementRow } = await supabase
    .from("content_placements")
    .select("*")
    .eq("id", placementId)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (!placementRow) return { ok: false, error: "placement not found for this firm", status: 404 };
  const placement = placementRow as ContentPlacement;

  const { data: deliverableRow } = await supabase
    .from("content_deliverables")
    .select("*")
    .eq("id", placement.deliverable_id)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (!deliverableRow) return { ok: false, error: "deliverable not found for this firm", status: 404 };
  const deliverable = deliverableRow as ContentDeliverable;

  const relevantVersionIds = [deliverable.approved_version_id, deliverable.current_version_id].filter(
    (id): id is string => id !== null,
  );
  const uniqueVersionIds = [...new Set(relevantVersionIds)];

  // Phase 1: everything needed to decide which version would release.
  const [
    { data: firmRow },
    periodResult,
    approvedVersionResult,
    currentVersionResult,
    artifactsResult,
    standingAuth,
    websiteBaseUrl,
    latestClaim,
    explicitDestinationConfig,
  ] = await Promise.all([
    supabase.from("intake_firms").select("id, location, name").eq("id", firmId).maybeSingle(),
    placement.period_id
      ? supabase.from("content_periods").select("*").eq("id", placement.period_id).maybeSingle()
      : Promise.resolve({ data: null as ContentPeriod | null }),
    deliverable.approved_version_id
      ? supabase.from("deliverable_versions").select("*").eq("id", deliverable.approved_version_id).maybeSingle()
      : Promise.resolve({ data: null as DeliverableVersion | null }),
    deliverable.current_version_id
      ? supabase.from("deliverable_versions").select("*").eq("id", deliverable.current_version_id).maybeSingle()
      : Promise.resolve({ data: null as DeliverableVersion | null }),
    uniqueVersionIds.length > 0
      ? supabase.from("publication_artifacts").select("*").in("version_id", uniqueVersionIds)
      : Promise.resolve({ data: [] as PublicationArtifact[] }),
    getStandingAuthorizationState(firmId),
    resolveValidatedWebsiteBaseUrl(firmId),
    getLatestClaimForPlacement(placementId),
    resolveExplicitDestinationConfig(firmId, placement.destination),
  ]);

  const period = (periodResult as { data: ContentPeriod | null }).data;
  const approvedVersion = (approvedVersionResult as { data: DeliverableVersion | null }).data;
  const currentVersion = (currentVersionResult as { data: DeliverableVersion | null }).data;
  const assets = ((artifactsResult as { data: PublicationArtifact[] | null }).data ?? []) as PublicationArtifact[];

  const validatedArtifactIds = new Set<string>();
  if (assets.length > 0) {
    const { data: validations } = await supabase
      .from("publication_artifact_validations")
      .select("artifact_id, result")
      .in(
        "artifact_id",
        assets.map((a) => a.id),
      )
      .eq("result", "pass");
    for (const v of (validations ?? []) as Array<{ artifact_id: string }>) validatedArtifactIds.add(v.artifact_id);
  }

  // Phase 2: now that path A/B eligibility is knowable, scope the receipt
  // lookup to the version that would actually release, not a hardcoded
  // approved_version_id (which is wrong under standing authorization).
  const release = resolveReleaseVersion({
    deliverable,
    approvedVersion,
    currentVersion,
    standingAuthorizationActive: standingAuth?.active ?? false,
  });
  const currentReceipt = release.releaseVersionId
    ? await getCurrentReceiptForPlacement(placementId, release.releaseVersionId)
    : null;

  const resolvedDestinationBaseUrl = placement.destination === "firm_website" ? websiteBaseUrl : null;

  const manifest = buildPublicationExecutionManifest({
    now: new Date().toISOString(),
    generatedBy,
    firmId,
    period: period ? { id: period.id, readinessLifecycle: period.readiness_lifecycle } : null,
    deliverable,
    approvedVersion,
    currentVersion,
    placement,
    assets,
    validatedArtifactIds,
    currentReceipt,
    standingAuthorizationActive: standingAuth?.active ?? false,
    resolvedDestinationBaseUrl,
    resolvedWebsiteBaseUrl: websiteBaseUrl,
    explicitDestinationConfig,
    scheduledTimezone: resolveFirmTimezone(firmRow ? { location: firmRow.location } : null),
    latestClaim: latestClaim
      ? { status: latestClaim.status, approvedVersionId: latestClaim.approved_version_id }
      : null,
  });

  return { ok: true, manifest };
}
