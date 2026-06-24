/**
 * /portal/[firmId]/deliverables
 *
 * Content approval hub. The operator posts marketing deliverables (article
 * drafts, ad copy, brand assets, images, PDFs); the firm's lawyer reviews,
 * comments, and signs off. Server-renders the list; creation + navigation are
 * in the client component.
 *
 * Auth: operator OR matching firm-lawyer session (parent layout). Client
 * sessions are excluded at page level.
 */

import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { getContentPlan } from "@/lib/deliverables";
import ContentPlan from "@/components/portal/ContentPlan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DeliverablesPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const { firmId } = await params;
  const { archived } = await searchParams;

  const session = await getPortalSession();
  if (!session || session.role === "client") {
    redirect("/portal/login");
  }
  const viewerRole = session.role === "operator" ? "operator" : "lawyer";
  const includeArchived = archived === "1";

  const plan = await getContentPlan(firmId, { includeArchived });

  return (
    <ContentPlan
      firmId={firmId}
      viewerRole={viewerRole}
      includeArchived={includeArchived}
      periods={plan.periods}
      deliverables={plan.deliverables}
    />
  );
}
