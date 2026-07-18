/**
 * /portal/[firmId]/deliverables/[deliverableId]
 *
 * Review surface for one deliverable. Server-loads the deliverable + versions
 * (assets signed) + comments + approval history, then hands off to the client
 * review component (annotation layer, comment thread, sign-off panel).
 *
 * Auth: operator OR matching firm-lawyer session. Client sessions excluded.
 */

import { notFound, redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { getPreviewIntent } from "@/lib/preview-mode";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { getDeliverableDetail } from "@/lib/deliverables";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { APPROVAL_ATTESTATION, CHANGES_ATTESTATION } from "@/lib/deliverables-pure";
import DeliverableReview from "@/components/portal/DeliverableReview";
import { listPlacementsForDeliverable } from "@/lib/content-placements";
import { getLatestClaimForPlacement } from "@/lib/publication-placement-claims";
import { getStandingAuthorizationState } from "@/lib/standing-publishing-authorization";
import PublicationStatusSummary, {
  type PlacementStatusRow,
} from "@/components/portal/PublicationStatusSummary";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DeliverableReviewPage({
  params,
}: {
  params: Promise<{ firmId: string; deliverableId: string }>;
}) {
  const { firmId, deliverableId } = await params;

  const session = await getPortalSession();
  if (!session || session.role === "client") {
    redirect("/portal/login");
  }

  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) redirect("/portal/login");

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) notFound();

  // DR-084: in a lawyer preview the operator sees the lawyer's sign-off panel
  // present-but-inert, not the operator "cannot sign" message. Render as the
  // firm's lawyer using the firm's on-file signer identity; a submit is refused
  // server-side by the approve route (lawyer-only + preview guard).
  const preview = await getPreviewIntent();
  const isLawyerPreview =
    session.role === "operator" && preview?.target === "lawyer" && preview.firm_id === firmId;

  let viewerRole: "operator" | "lawyer" = resolved.actor.role;
  let signerName = resolved.actor.name ?? null;
  let signerEmail = resolved.actor.email ?? null;
  if (isLawyerPreview) {
    const { data: firm } = await supabase
      .from("intake_firms")
      .select("branding")
      .eq("id", firmId)
      .maybeSingle();
    const branding = (firm?.branding as { lawyer_email?: string; lawyer_name?: string } | null) ?? null;
    viewerRole = "lawyer";
    signerName = branding?.lawyer_name ?? "Authorised lawyer";
    signerEmail = branding?.lawyer_email ?? null;
  }

  const statusRows = await buildPlacementStatusRows(firmId, detail);

  return (
    <div className="space-y-4">
      <PublicationStatusSummary rows={statusRows} />
      <DeliverableReview
        firmId={firmId}
        viewerRole={viewerRole}
        signerName={signerName}
        signerEmail={signerEmail}
        approvalAttestation={APPROVAL_ATTESTATION}
        changesAttestation={CHANGES_ATTESTATION}
        initialDetail={detail}
      />
    </div>
  );
}

/**
 * Truthful, per-placement publication status for the detail page. Never
 * shows "authorized for publication under standing authorization" unless
 * an actual claim recorded that release path for the CURRENT version --
 * a stale claim from an earlier version is historical, not current
 * status, and is treated the same as "no claim yet".
 */
async function buildPlacementStatusRows(
  firmId: string,
  detail: NonNullable<Awaited<ReturnType<typeof getDeliverableDetail>>>,
): Promise<PlacementStatusRow[]> {
  const { deliverable } = detail;
  const currentVersionId = deliverable.current_version_id;
  const currentVersion = detail.versions.find((v) => v.id === currentVersionId) ?? null;

  const [placements, authState] = await Promise.all([
    listPlacementsForDeliverable(deliverable.id),
    getStandingAuthorizationState(firmId),
  ]);
  if (placements.length === 0) return [];

  const rows: PlacementStatusRow[] = [];
  for (const placement of placements) {
    const claim = await getLatestClaimForPlacement(placement.id);
    const claimIsForCurrentVersion = claim && claim.approved_version_id === currentVersionId;

    let publicationVerificationState: PlacementStatusRow["publicationVerificationState"] = null;
    if (claimIsForCurrentVersion && claim!.status === "released") {
      const { data: receipt } = await supabase
        .from("publication_receipts")
        .select("verification_state")
        .eq("placement_id", placement.id)
        .eq("approved_version_id", currentVersionId as string)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      publicationVerificationState =
        (receipt?.verification_state as PlacementStatusRow["publicationVerificationState"]) ?? null;
    }

    if (
      deliverable.status === "approved" &&
      deliverable.approved_version_id === currentVersionId &&
      deliverable.approved_version_id != null
    ) {
      rows.push({
        placementId: placement.id,
        destination: placement.destination,
        kind: "individually_approved",
        effectiveAt: claimIsForCurrentVersion ? claim!.claimed_at : null,
        individualReviewReason: null,
        publicationVerificationState,
      });
      continue;
    }

    if (currentVersion?.requires_individual_review) {
      rows.push({
        placementId: placement.id,
        destination: placement.destination,
        kind: "individual_review_required",
        effectiveAt: null,
        individualReviewReason: currentVersion.requires_individual_review_reason,
        publicationVerificationState: null,
      });
      continue;
    }

    if (claimIsForCurrentVersion && claim!.release_path === "standing_authorization") {
      rows.push({
        placementId: placement.id,
        destination: placement.destination,
        kind: "authorized_standing",
        effectiveAt: claim!.claimed_at,
        individualReviewReason: null,
        publicationVerificationState,
      });
      continue;
    }

    rows.push({
      placementId: placement.id,
      destination: placement.destination,
      kind: authState?.active ? "eligible_standing" : "individual_review_required",
      effectiveAt: null,
      individualReviewReason: null,
      publicationVerificationState: null,
    });
  }
  return rows;
}
