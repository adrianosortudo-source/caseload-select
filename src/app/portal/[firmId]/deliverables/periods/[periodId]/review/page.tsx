/**
 * /portal/[firmId]/deliverables/periods/[periodId]/review -- Review tab
 * (Section 14). Auth already gated by the parent layout; viewerRole drives
 * which of the two presentations filterPackageForViewer built renders.
 */
import { getPortalSession } from "@/lib/portal-auth";
import { loadControlRoomPackage } from "@/lib/publishing-package-control-room-loader";
import { assembleOverviewViewModel } from "@/lib/publishing-package-control-room-overview";
import { filterPackageForViewer } from "@/lib/publishing-package-control-room-review";
import ReviewTabView from "@/components/portal/control-room/ReviewTabView";

export default async function ControlRoomReviewPage({
  params,
}: {
  params: Promise<{ firmId: string; periodId: string }>;
}) {
  const { firmId, periodId } = await params;
  const [session, result] = await Promise.all([
    getPortalSession(),
    loadControlRoomPackage(firmId, periodId),
  ]);

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

  const viewerRole: "operator" | "lawyer" = session?.role === "operator" ? "operator" : "lawyer";
  const overview = assembleOverviewViewModel(
    result.manifest,
    result.packageStatus,
    result.assets.map((a) => ({ id: a.id, status: a.status, filename: a.filename })),
  );
  const view = filterPackageForViewer(overview, result.assets, viewerRole);

  return <ReviewTabView view={view} />;
}
