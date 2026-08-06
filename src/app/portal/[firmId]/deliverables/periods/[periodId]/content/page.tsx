/**
 * /portal/[firmId]/deliverables/periods/[periodId]/content -- Content tab
 * (Section 10). Auth already gated by the parent layout.
 */
import { loadControlRoomPackage } from "@/lib/publishing-package-control-room-loader";
import { assembleOverviewViewModel } from "@/lib/publishing-package-control-room-overview";
import ContentTabView from "@/components/portal/control-room/ContentTabView";

export default async function ControlRoomContentPage({
  params,
}: {
  params: Promise<{ firmId: string; periodId: string }>;
}) {
  const { firmId, periodId } = await params;
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

  const viewModel = assembleOverviewViewModel(
    result.manifest,
    result.packageStatus,
    result.assets.map((a) => ({ id: a.id, status: a.status, filename: a.filename })),
  );

  return <ContentTabView firmId={firmId} rows={viewModel.rows} />;
}
