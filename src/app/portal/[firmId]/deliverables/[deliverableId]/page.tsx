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

  return (
    <DeliverableReview
      firmId={firmId}
      viewerRole={viewerRole}
      signerName={signerName}
      signerEmail={signerEmail}
      approvalAttestation={APPROVAL_ATTESTATION}
      changesAttestation={CHANGES_ATTESTATION}
      initialDetail={detail}
    />
  );
}
