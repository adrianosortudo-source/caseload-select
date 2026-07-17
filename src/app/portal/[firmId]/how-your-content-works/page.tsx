/**
 * /portal/[firmId]/how-your-content-works
 *
 * Full visual explainer of the firm's weekly content cadence, plus the
 * primary control for Standing Publishing Authorization -- placed
 * immediately after the introductory explanation of how review and
 * publishing work, per the product spec. Linked from the summary card on
 * the deliverables page. Same auth as the deliverables hub: operator OR
 * matching firm-lawyer session; client sessions excluded.
 *
 * Unlike before this feature existed, this page no longer 404s for firms
 * without a cadence config: standing authorization must be reachable
 * regardless of whether a firm's weekly-cadence explainer is configured.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { getContentCadence } from "@/lib/content-cadence";
import { getFirmAbout } from "@/lib/firm-about";
import ContentCadencePanel from "@/components/portal/ContentCadencePanel";
import AboutPanel from "@/components/portal/AboutPanel";
import StandingAuthorizationCard from "@/components/portal/StandingAuthorizationCard";
import { getFirmDisplayName, getStandingAuthorizationState } from "@/lib/standing-publishing-authorization";

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
  const viewerRole = session.role === "operator" ? "operator" : "lawyer";

  const [about, firmName, authState] = await Promise.all([
    getFirmAbout(firmId),
    getFirmDisplayName(firmId),
    getStandingAuthorizationState(firmId),
  ]);

  return (
    <div className="space-y-4">
      <Link
        href={`/portal/${firmId}/deliverables`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-navy hover:underline"
      >
        <span aria-hidden>&larr;</span> Back to content
      </Link>
      {cadence ? (
        <ContentCadencePanel cadence={cadence} variant="full" referenceLinks={about?.links} />
      ) : about ? (
        <AboutPanel bodyHtml={about.body_html} links={about.links} />
      ) : null}
      <StandingAuthorizationCard
        firmId={firmId}
        firmName={firmName ?? "your firm"}
        viewerRole={viewerRole}
        active={authState?.active ?? false}
        latestEvent={authState?.latestEvent ?? null}
      />
    </div>
  );
}
