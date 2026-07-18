/**
 * Publication Operator, Workstream 1: I/O loader for
 * PublicationExecutionManifest. Assembles stored, immutable records only --
 * a request body may supply identifiers (firmId, placementId) but nothing
 * else this loader returns. Mirrors the existing codebase's own thin-loader
 * convention (see publication-preflight-loader.ts): every branching
 * decision lives in the pure builder (publication-execution-manifest.ts),
 * this file only fetches and shapes rows for it.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { resolveFirmTimezone } from "@/lib/firm-timezone";
import { getStandingAuthorizationState } from "@/lib/standing-publishing-authorization";
import { getCurrentReceiptForPlacement } from "@/lib/publication-receipts";
import { getLatestClaimForPlacement } from "@/lib/publication-placement-claims";
import {
  buildPublicationExecutionManifest,
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
 * Resolves a real, previously-verified destination base URL for this firm +
 * destination from EXISTING evidence only -- the most recent 'webpage'
 * publication_artifacts row across the firm's deliverables that carries a
 * public_url, or failing that the most recent verified firm_website receipt.
 * Never guesses, never hardcodes a per-firm domain. Returns null when no
 * such evidence exists yet (a brand-new firm's first-ever placement).
 *
 * Scoped to destination === "firm_website" only: LinkedIn/GBP/email have no
 * concept of a "base URL" an intended_path resolves against (see
 * publication-execution-manifest.ts's resolveDestinationAccount for why
 * those destinations always report unconfigured).
 */
async function resolveDestinationBaseUrlForFirm(
  firmId: string,
  destination: PlacementDestination,
): Promise<string | null> {
  if (destination !== "firm_website") return null;

  const { data: artifactRows } = await supabase
    .from("publication_artifacts")
    .select("public_url, created_at")
    .eq("firm_id", firmId)
    .eq("artifact_type", "webpage")
    .not("public_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);

  const artifactUrl = (artifactRows?.[0] as { public_url: string | null } | undefined)?.public_url ?? null;
  if (artifactUrl) {
    try {
      return new URL(artifactUrl).origin;
    } catch {
      // fall through to receipts
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

  const [{ data: firmRow }, periodResult, versionResult, artifactsResult, standingAuth, currentReceipt, baseUrl, latestClaim] =
    await Promise.all([
      supabase.from("intake_firms").select("id, location, name").eq("id", firmId).maybeSingle(),
      placement.period_id
        ? supabase.from("content_periods").select("*").eq("id", placement.period_id).maybeSingle()
        : Promise.resolve({ data: null as ContentPeriod | null }),
      deliverable.approved_version_id
        ? supabase
            .from("deliverable_versions")
            .select("*")
            .eq("id", deliverable.approved_version_id)
            .maybeSingle()
        : Promise.resolve({ data: null as DeliverableVersion | null }),
      deliverable.approved_version_id
        ? supabase
            .from("publication_artifacts")
            .select("*")
            .eq("version_id", deliverable.approved_version_id)
        : Promise.resolve({ data: [] as PublicationArtifact[] }),
      getStandingAuthorizationState(firmId),
      deliverable.approved_version_id
        ? getCurrentReceiptForPlacement(placementId, deliverable.approved_version_id)
        : Promise.resolve(null),
      resolveDestinationBaseUrlForFirm(firmId, placement.destination),
      getLatestClaimForPlacement(placementId),
    ]);

  const period = (periodResult as { data: ContentPeriod | null }).data;
  const approvedVersion = (versionResult as { data: DeliverableVersion | null }).data;
  const assets = ((artifactsResult as { data: PublicationArtifact[] | null }).data ?? []) as PublicationArtifact[];

  const manifest = buildPublicationExecutionManifest({
    now: new Date().toISOString(),
    generatedBy,
    firmId,
    period: period ? { id: period.id, readinessLifecycle: period.readiness_lifecycle } : null,
    deliverable,
    approvedVersion,
    placement,
    assets,
    currentReceipt,
    standingAuthorizationActive: standingAuth?.active ?? false,
    resolvedDestinationBaseUrl: baseUrl,
    scheduledTimezone: resolveFirmTimezone(firmRow ? { location: firmRow.location } : null),
    latestClaim: latestClaim
      ? { status: latestClaim.status, approvedVersionId: latestClaim.approved_version_id }
      : null,
  });

  return { ok: true, manifest };
}
