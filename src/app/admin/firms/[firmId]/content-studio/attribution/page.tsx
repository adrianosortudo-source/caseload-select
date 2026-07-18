/**
 * /admin/firms/[firmId]/content-studio/attribution
 *
 * Firm-scoped Content Performance shim, mirroring the sibling
 * /admin/firms/[firmId]/content-studio shim: delegates to the real
 * surface with the firm pre-selected via searchParam.
 */

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FirmContentPerformancePage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;
  redirect(`/admin/content-studio/attribution?firm_id=${firmId}`);
}
