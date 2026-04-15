/**
 * /portal/[firmId]
 *
 * Root entry point — redirects to the Dashboard tab.
 * Auth is verified in the parent [firmId]/layout.tsx before this renders.
 * Preserves existing bookmarks and magic links.
 */

import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

export default async function PortalRoot({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const session = await getPortalSession();
  const { firmId } = await params;

  if (!session || session.firm_id !== firmId) {
    redirect("/portal/login");
  }

  redirect(`/portal/${firmId}/dashboard`);
}
