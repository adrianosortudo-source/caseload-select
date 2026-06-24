/**
 * /admin/firms/[firmId]/content-studio
 *
 * Firm-scoped content studio. Delegates to the existing content-studio
 * surface with the firm pre-selected via searchParam until the full
 * firm-scoped page is built.
 */

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FirmContentStudioPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;
  redirect(`/admin/content-studio?firm_id=${firmId}`);
}
