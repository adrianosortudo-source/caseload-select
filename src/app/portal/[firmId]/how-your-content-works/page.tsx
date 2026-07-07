/**
 * /portal/[firmId]/how-your-content-works
 *
 * Full visual explainer of the firm's weekly content cadence. Linked from the
 * summary card on the deliverables page. Same auth as the deliverables hub:
 * operator OR matching firm-lawyer session; client sessions excluded.
 *
 * Renders only for firms that have a cadence config; others 404 (the plain
 * AboutPanel stays their explainer surface).
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { getContentCadence } from "@/lib/content-cadence";
import { getFirmAbout } from "@/lib/firm-about";
import ContentCadencePanel from "@/components/portal/ContentCadencePanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HowYourContentWorksPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;

  const session = await getPortalSession();
  if (!session || session.role === "client") {
    redirect("/portal/login");
  }

  const cadence = getContentCadence(firmId);
  if (!cadence) notFound();

  const about = await getFirmAbout(firmId);

  return (
    <div className="space-y-4">
      <Link
        href={`/portal/${firmId}/deliverables`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-navy hover:underline"
      >
        <span aria-hidden>&larr;</span> Back to content
      </Link>
      <ContentCadencePanel
        cadence={cadence}
        variant="full"
        referenceLinks={about?.links}
      />
    </div>
  );
}
