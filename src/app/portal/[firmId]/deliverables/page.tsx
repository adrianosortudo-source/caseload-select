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

import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { getContentPlan } from "@/lib/deliverables";
import { getFirmAbout } from "@/lib/firm-about";
import { getContentCadence } from "@/lib/content-cadence";
import { loadPlanPublicationReadiness } from "@/lib/publication-readiness-loader";
import { getStandingAuthorizationState } from "@/lib/standing-publishing-authorization";
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
  const authState = await getStandingAuthorizationState(firmId);

  // Additive: Publication Readiness (Workstream 5). loadPlanPublicationReadiness
  // never throws on its own, but the .catch below is a second, independent
  // guard so a readiness-load failure can never take down a page that
  // rendered fine before this feature existed.
  const planReadiness = await loadPlanPublicationReadiness(firmId).catch(() => ({
    summary: { active: 0, ready: 0, blocked: 0, excluded: 0 },
    items: [],
    titles: {},
    lifecycleByDeliverableId: {},
    // loadPlanPublicationReadiness does not throw on its own (it resolves
    // every internal failure to an unavailable:true result); this .catch is
    // a second, independent guard for anything unexpected reaching this
    // far. It must mark unavailable too, for the same reason the loader's
    // own error paths do: an empty result here must never render as "all
    // clear" to the operator.
    unavailable: true,
  }));

  return (
    <div className="space-y-6">
      <StandingAuthorizationBanner firmId={firmId} active={authState?.active ?? false} />
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

/**
 * Status banner above the content weeks. Deliberately does not duplicate
 * the full authorization form (that lives at how-your-content-works) --
 * just truthful current-state language and the two links a viewer needs.
 */
function StandingAuthorizationBanner({ firmId, active }: { firmId: string; active: boolean }) {
  return (
    <div
      className={`border rounded p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 ${
        active ? "bg-green-pass/5 border-green-pass/25" : "bg-parchment border-border-brand"
      }`}
    >
      <span
        aria-hidden
        className={`hidden sm:inline-block w-2.5 h-2.5 rounded-full ${active ? "bg-green-pass" : "bg-black/25"}`}
      />
      <p className="text-sm text-black/75 flex-1">
        {active
          ? "Standing publishing authorization is active. Eligible content can be published after QA without waiting for individual review."
          : "Individual approval is required before publication."}
      </p>
      <div className="flex gap-4">
        <Link
          href={`/portal/${firmId}/how-your-content-works`}
          className="text-xs font-semibold uppercase tracking-wider text-navy hover:underline whitespace-nowrap"
        >
          {active ? "How it works" : "Review how approval works"}
        </Link>
        {active && (
          <Link
            href={`/portal/${firmId}/how-your-content-works`}
            className="text-xs font-semibold uppercase tracking-wider text-navy hover:underline whitespace-nowrap"
          >
            Manage authorization
          </Link>
        )}
      </div>
    </div>
  );
}
