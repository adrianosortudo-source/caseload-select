/**
 * /portal/[firmId]/deliverables/periods/[periodId]/assets -- Assets tab
 * (Section 11). Auth already gated by the parent layout; this page only
 * needs the viewer's role (operator vs lawyer) to decide which action
 * controls render.
 */
import { getPortalSession } from "@/lib/portal-auth";
import { loadControlRoomPackage } from "@/lib/publishing-package-control-room-loader";
import { assembleAssetsViewModel } from "@/lib/publishing-package-control-room-assets";
import AssetsTabView from "@/components/portal/control-room/AssetsTabView";

export default async function ControlRoomAssetsPage({
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
  const viewModel = assembleAssetsViewModel(result.manifest, result.assets);

  return (
    <AssetsTabView
      firmId={firmId}
      periodId={periodId}
      manifest={result.manifest}
      groups={viewModel.groups}
      allCards={viewModel.allCards}
      viewerRole={viewerRole}
    />
  );
}
