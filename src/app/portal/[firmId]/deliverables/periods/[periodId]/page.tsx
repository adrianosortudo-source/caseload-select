/**
 * /portal/[firmId]/deliverables/periods/[periodId] -- Control Room Overview
 * (Section 9). Auth already gated by the parent layout.
 */
import { getPortalSession } from "@/lib/portal-auth";
import { loadControlRoomPackage } from "@/lib/publishing-package-control-room-loader";
import { assembleOverviewViewModel } from "@/lib/publishing-package-control-room-overview";
import OverviewTabView from "@/components/portal/control-room/OverviewTabView";
import CreateManifestPanel from "@/components/portal/control-room/CreateManifestPanel";

function formatPeriodDates(startsOn: string, endsOn: string): string {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  return `${fmt(startsOn)} – ${fmt(endsOn)}`;
}

export default async function ControlRoomOverviewPage({
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
        {session?.role === "operator" && <CreateManifestPanel firmId={firmId} periodId={periodId} />}
      </div>
    );
  }

  const viewModel = assembleOverviewViewModel(
    result.manifest,
    result.packageStatus,
    result.assets.map((a) => ({ id: a.id, status: a.status, filename: a.filename })),
  );

  return (
    <OverviewTabView
      firmId={firmId}
      periodId={periodId}
      periodTitle={result.period.theme ?? "Weekly package"}
      periodDates={formatPeriodDates(result.period.starts_on, result.period.ends_on)}
      viewModel={viewModel}
    />
  );
}
