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
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { getDeliverableDetail } from "@/lib/deliverables";
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

  return (
    <DeliverableReview
      firmId={firmId}
      viewerRole={resolved.actor.role}
      signerName={resolved.actor.name ?? null}
      signerEmail={resolved.actor.email ?? null}
      approvalAttestation={APPROVAL_ATTESTATION}
      changesAttestation={CHANGES_ATTESTATION}
      initialDetail={detail}
    />
  );
}
