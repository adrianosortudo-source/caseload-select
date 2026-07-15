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
import { getFirmAbout } from "@/lib/firm-about";
import { getContentCadence } from "@/lib/content-cadence";
import { loadPlanPublicationReadiness } from "@/lib/publication-readiness-loader";
import ContentPlan from "@/components/portal/ContentPlan";
import AboutPanel from "@/components/portal/AboutPanel";
import ContentCadencePanel from "@/components/portal/ContentCadencePanel";

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

  const [plan, about] = await Promise.all([
    getContentPlan(firmId, { includeArchived }),
    getFirmAbout(firmId),
  ]);

  const cadence = getContentCadence(firmId);

  // Additive: Publication Readiness (Workstream 5). loadPlanPublicationReadiness
  // never throws on its own, but the .catch below is a second, independent
  // guard so a readiness-load failure can never take down a page that
  // rendered fine before this feature existed.
  const planReadiness = await loadPlanPublicationReadiness(firmId).catch(() => ({
    summary: { active: 0, ready: 0, blocked: 0, excluded: 0 },
    items: [],
    titles: {},
    lifecycleByDeliverableId: {},
  }));

  return (
    <div className="space-y-6">
      {cadence ? (
        <ContentCadencePanel
          cadence={cadence}
          variant="summary"
          detailHref={`/portal/${firmId}/how-your-content-works`}
        />
      ) : about ? (
        <AboutPanel bodyHtml={about.body_html} links={about.links} />
      ) : null}
      <ContentPlan
        firmId={firmId}
        viewerRole={viewerRole}
        includeArchived={includeArchived}
        periods={plan.periods}
        deliverables={plan.deliverables}
        settings={plan.settings}
        planReadiness={planReadiness}
      />
    </div>
  );
}
