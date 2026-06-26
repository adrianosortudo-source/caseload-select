/**
 * /portal/[firmId]
 *
 * Root entry point  -  redirects to the Dashboard tab.
 * Auth is verified in the parent [firmId]/layout.tsx before this renders.
 * Preserves existing bookmarks and magic links.
 */

import { redirect } from "next/navigation";
import { requirePortalViewer } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

export default async function PortalRoot({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;
  // Operator-view contract (DR-076).
  await requirePortalViewer(firmId);

  redirect(`/portal/${firmId}/dashboard`);
}
