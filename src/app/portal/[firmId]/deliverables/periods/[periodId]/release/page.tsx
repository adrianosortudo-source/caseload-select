/**
 * /portal/[firmId]/deliverables/periods/[periodId]/release -- Release tab
 * (Section 15). Operator-only (the parent layout already redirects
 * non-firm-matched lawyers/clients; this page additionally excludes
 * lawyers, since Section 15's gates surface internal reason codes).
 *
 * PublicationInputs assembly (standing authorization + per-piece
 * approval/receipt maps) is built by loadPublicationInputs()
 * (publishing-package-control-room-loader.ts) -- the same helper the
 * preflight-persistence mutation calls, so there is exactly one
 * implementation of this logic, not two that can drift apart.
 */
import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { loadControlRoomPackage, loadPublicationInputs } from "@/lib/publishing-package-control-room-loader";
import { assembleOverviewViewModel } from "@/lib/publishing-package-control-room-overview";
import { assembleReleaseGates } from "@/lib/publishing-package-control-room-release";
import ReleaseTabView from "@/components/portal/control-room/ReleaseTabView";

export default async function ControlRoomReleasePage({
  params,
}: {
  params: Promise<{ firmId: string; periodId: string }>;
}) {
  const { firmId, periodId } = await params;
  const session = await getPortalSession();
  if (!session || session.role === "client" || session.role === "lawyer") {
    redirect(`/portal/${firmId}/deliverables/periods/${periodId}`);
  }

  const result = await loadControlRoomPackage(firmId, periodId);

  if (!result) {
    return (
      <div className="bg-white border border-black/8 p-6 text-center">
        <h1 className="text-lg font-semibold text-navy">No package manifest for this period yet</h1>
        <p className="text-sm text-black/50 mt-1">
          The Weekly Package Control Room activates when a package manifest is created for this period.
        </p>
      </div>
    );
  }

  const deliverableIds = [...new Set(result.manifest.pieces.map((p) => p.deliverableId).filter((id): id is string => !!id))];
  const publicationInputs = await loadPublicationInputs(firmId, deliverableIds);

  const overview = assembleOverviewViewModel(
    result.manifest,
    result.packageStatus,
    result.assets.map((a) => ({ id: a.id, status: a.status, filename: a.filename })),
  );
  const pieces = assembleReleaseGates(overview, result.manifest, publicationInputs);

  return <ReleaseTabView pieces={pieces} firmId={firmId} periodId={periodId} canRun />;
}
