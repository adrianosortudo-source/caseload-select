/**
 * I/O loader for the Canonical Publication Packet (publication-packet.ts).
 * Same query pattern this codebase's other period-scoped loaders already
 * use (publication-preflight-loader.ts, publication-readiness-loader.ts):
 * thin wrapper, every actual decision lives in the pure module.
 *
 * CTA reachability (cta_resolves) is the one genuinely I/O-shaped check a
 * packet needs and the only network call this loader makes -- via an
 * INJECTED fetch implementation, so callers (and every test in this repo)
 * control it explicitly. No default production siteOrigin is hardcoded
 * here; the caller supplies it (this codebase serves multiple firms with
 * different site origins, and no per-firm domain field exists in
 * intake_firms today to auto-discover one from).
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { listCurrentReceiptsByPlacementForDeliverable } from "@/lib/publication-receipts";
import { getStandingAuthorizationState } from "@/lib/standing-publishing-authorization";
import {
  assemblePublicationPacket,
  type PublicationPacket,
  type PublicationPacketBlockerCode,
} from "@/lib/publication-packet";
import type {
  ContentDeliverable,
  ContentPlacement,
  DeliverableVersion,
  PublicationArtifact,
  PublicationArtifactValidation,
  PublicationReceipt,
} from "@/lib/types";

/** Deliverable roles the calibration report identifies as CTA-driven (a teaser/post promoting a separate live article) -- a minimal, disclosed domain rule grounded in DeliverableRole, not an invented one. */
const CTA_REQUIRED_ROLES = new Set(["gbp_post", "social_post"]);

export interface PublicationPacketPeriodResult {
  packets: PublicationPacket[];
  /** deliverable id -> title, for surfaces that only have packets. */
  titles: Record<string, string>;
  /** Mutually exclusive and always summing to total (2026-07-22 audit follow-up) -- every packet is published XOR readyToPublish XOR needsAttention, per PublicationPacket's own state-exclusivity invariant. */
  summary: { published: number; readyToPublish: number; needsAttention: number; total: number };
  /** One precise reason per genuinely outstanding (not yet published) item -- calibration report requirement: "report published, pending, failed, and blocked items with one precise reason per exception." state distinguishes "awaiting_publication" (readyToPublish -- everything checks out, publication just hasn't happened yet) from "blocked" (needsAttention -- a real check failure). An awaiting_publication entry's reasons list contains only the publication_proof line, never a defect. */
  outstanding: Array<{ deliverableId: string; channel: ContentPlacement["destination"]; state: "awaiting_publication" | "blocked"; reasons: string[] }>;
}

async function checkCtaReachable(
  targetPath: string,
  siteOrigin: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const url = new URL(targetPath, siteOrigin).toString();
    const res = await fetchImpl(url, { method: "HEAD" });
    if (res.status >= 200 && res.status < 300) return true;
    // Some hosts don't support HEAD; retry with GET before concluding failure.
    if (res.status === 405) {
      const getRes = await fetchImpl(url, { method: "GET" });
      return getRes.status >= 200 && getRes.status < 300;
    }
    return false;
  } catch {
    return false;
  }
}

export async function loadPublicationPacketsForPeriod(
  periodId: string,
  firmId: string,
  opts: { siteOrigin: string; fetchImpl?: typeof fetch },
): Promise<PublicationPacketPeriodResult | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;

  const { data: deliverables, error: delErr } = await supabase
    .from("content_deliverables")
    .select("*")
    .eq("period_id", periodId)
    .eq("firm_id", firmId);
  if (delErr) throw new Error(`could not load deliverables: ${delErr.message}`);
  const rows = (deliverables ?? []) as ContentDeliverable[];
  if (rows.length === 0) return null;

  const activeRows = rows.filter((d) => d.status !== "archived");
  const deliverableIds = activeRows.map((d) => d.id);
  const versionIds = activeRows.map((d) => d.current_version_id).filter((id): id is string => !!id);

  const [{ data: versions }, { data: placements }, { data: artifacts }, standingAuthorization] = await Promise.all([
    versionIds.length
      ? supabase.from("deliverable_versions").select("*").in("id", versionIds)
      : Promise.resolve({ data: [] as DeliverableVersion[] }),
    deliverableIds.length
      ? supabase.from("content_placements").select("*").in("deliverable_id", deliverableIds)
      : Promise.resolve({ data: [] as ContentPlacement[] }),
    deliverableIds.length
      ? supabase.from("publication_artifacts").select("*").in("deliverable_id", deliverableIds)
      : Promise.resolve({ data: [] as PublicationArtifact[] }),
    getStandingAuthorizationState(firmId),
  ]);

  const versionById = new Map(((versions ?? []) as DeliverableVersion[]).map((v) => [v.id, v]));
  const allArtifacts = (artifacts ?? []) as PublicationArtifact[];
  const placementsByDeliverableId = new Map<string, ContentPlacement[]>();
  for (const p of (placements ?? []) as ContentPlacement[]) {
    const list = placementsByDeliverableId.get(p.deliverable_id) ?? [];
    list.push(p);
    placementsByDeliverableId.set(p.deliverable_id, list);
  }

  const artifactIds = allArtifacts.map((a) => a.id);
  const { data: validations } = artifactIds.length
    ? await supabase.from("publication_artifact_validations").select("*").in("artifact_id", artifactIds).order("created_at", { ascending: false })
    : { data: [] as PublicationArtifactValidation[] };
  const latestValidationByArtifactId: Record<string, PublicationArtifactValidation | undefined> = {};
  for (const v of (validations ?? []) as PublicationArtifactValidation[]) {
    if (!latestValidationByArtifactId[v.artifact_id]) latestValidationByArtifactId[v.artifact_id] = v;
  }

  const receiptsByDeliverable = await Promise.all(
    activeRows.map((d) => listCurrentReceiptsByPlacementForDeliverable(d.id, d.approved_version_id)),
  );
  const receiptsByPlacementId: Record<string, PublicationReceipt | null> = {};
  receiptsByDeliverable.forEach((part) => Object.assign(receiptsByPlacementId, part));

  const standingAuthorizationActive = standingAuthorization?.active ?? false;

  const packets: PublicationPacket[] = [];
  const titles: Record<string, string> = {};
  for (const deliverable of activeRows) {
    titles[deliverable.id] = deliverable.title;
    const currentVersion = deliverable.current_version_id ? (versionById.get(deliverable.current_version_id) ?? null) : null;
    const deliverableArtifacts = allArtifacts.filter((a) => a.deliverable_id === deliverable.id);
    const ctaRequired = !!deliverable.deliverable_role && CTA_REQUIRED_ROLES.has(deliverable.deliverable_role);

    // Computed ONCE per deliverable, not once per placement (2026-07-22 audit
    // follow-up) -- cta_target_path is a deliverable-level fact, so a
    // deliverable with N placements previously re-fetched the identical URL
    // N times.
    const ctaHttpCheckPassed: boolean | null = deliverable.cta_target_path
      ? await checkCtaReachable(deliverable.cta_target_path, opts.siteOrigin, fetchImpl)
      : null;

    for (const placement of placementsByDeliverableId.get(deliverable.id) ?? []) {
      const currentReceipt = receiptsByPlacementId[placement.id] ?? null;

      packets.push(
        assemblePublicationPacket({
          deliverable,
          currentVersion,
          placement,
          artifacts: allArtifacts,
          readinessInput: { currentVersion, artifacts: deliverableArtifacts, latestValidationByArtifactId },
          standingAuthorizationActive,
          ctaRequired,
          ctaLabel: null, // see publication-packet.ts header comment: no schema field exists for this today
          ctaHttpCheckPassed,
          currentReceipt,
        }),
      );
    }
  }

  // Mutually exclusive by construction -- assemblePublicationPacket's own
  // state-exclusivity invariant guarantees published/readyToPublish/
  // needsAttention never overlap on one packet, so these three filters
  // partition `packets` exactly (no defensive !p.published guard needed
  // here; it would only mask a real regression in that invariant).
  const published = packets.filter((p) => p.published).length;
  const readyToPublish = packets.filter((p) => p.readyToPublish).length;
  const needsAttention = packets.filter((p) => p.needsAttention).length;

  const outstanding = packets
    .filter((p) => !p.published)
    .map((p) => ({
      deliverableId: p.identity.deliverableId,
      channel: p.identity.channel,
      state: (p.readyToPublish ? "awaiting_publication" : "blocked") as "awaiting_publication" | "blocked",
      reasons: p.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.reason}`),
    }));

  return {
    packets,
    titles,
    summary: { published, readyToPublish, needsAttention, total: packets.length },
    outstanding,
  };
}

export type { PublicationPacketBlockerCode };
