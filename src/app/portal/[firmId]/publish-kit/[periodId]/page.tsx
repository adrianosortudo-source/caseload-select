/**
 * /portal/[firmId]/publish-kit/[periodId]
 *
 * The Publish Kit itself: every deliverable in one content period, its
 * approved copy, its recorded slot crops, and the gates that decide whether
 * each can go out. Operator-only, read-only.
 *
 * Source of truth: buildContentExportBundle (src/lib/content-period-export.ts),
 * the same publishing-export bundle already exposed at
 * /api/admin/content-periods/[periodId]/content-export. This page renders
 * that bundle for a human; @/lib/publish-kit-pure maps it into the view
 * model and the agent-facing record format. No new data layer, no writes.
 */

import { notFound, redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { buildContentExportBundle } from "@/lib/content-period-export";
import { toPublishKitView } from "@/lib/publish-kit-pure";
import PublishKit from "@/components/portal/PublishKit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublishKitPeriodPage({
  params,
}: {
  params: Promise<{ firmId: string; periodId: string }>;
}) {
  const { firmId, periodId } = await params;

  const session = await getPortalSession();
  if (!session) redirect("/portal/login");
  if (session.role !== "operator") notFound();

  const result = await buildContentExportBundle(periodId);
  if (!result.ok) notFound();

  // Defense in depth: a period that exists but belongs to a different firm
  // than the one in the URL must never render under that firm's branding.
  if (result.bundle.firm.id !== firmId) notFound();

  const view = toPublishKitView(result.bundle);

  return <PublishKit view={view} firmId={firmId} />;
}
