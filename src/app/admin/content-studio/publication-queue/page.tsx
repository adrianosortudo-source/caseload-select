/**
 * Publication Operator, Workstream 5: the operator Publication Queue.
 *
 * Read-only. Never publishes, claims, or writes a receipt from this page --
 * every action here is a link to a read-only detail view or the underlying
 * read-only API route. Reuses the existing, tested Workstream 7 preflight
 * report (loadPublicationPreflightForPeriod) for the list view rather than
 * running the full, per-placement PublicationExecutionManifest pipeline for
 * every row; the richer manifest/adapter picture (destination-format
 * checks, existing-claim awareness, dry-run render) is one click away on
 * the detail page ("Run dry preflight" below), matching the brief's own
 * split between a lightweight queue and an explicit per-placement preflight
 * action.
 *
 * Firm/period selection follows this directory's existing convention
 * (server component, supabaseAdmin, `?firm_id=` query param; see
 * coverage/page.tsx). Auth is enforced by /admin/layout.tsx.
 */
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { loadPublicationPreflightForPeriod } from "@/lib/publication-preflight-loader";
import { roughCategory, QUEUE_CATEGORY_LABEL, QUEUE_CATEGORY_TONE } from "@/lib/publication-queue-pure";

export const dynamic = "force-dynamic";

type Firm = { id: string; name: string | null };
type Period = {
  id: string;
  theme: string | null;
  starts_on: string;
  ends_on: string;
  readiness_lifecycle: "legacy_unreconciled" | "setup_required" | "enforced";
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function lifecycleBadge(lifecycle: Period["readiness_lifecycle"]) {
  const label =
    lifecycle === "enforced" ? "Enforced" : lifecycle === "setup_required" ? "Setup required" : "Historical";
  const tone =
    lifecycle === "enforced"
      ? "bg-emerald-50 text-emerald-700"
      : lifecycle === "setup_required"
        ? "bg-amber-50 text-amber-700"
        : "bg-black/5 text-black/50";
  return <span className={`inline-block px-2.5 py-0.5 rounded text-xs font-medium ${tone}`}>{label}</span>;
}

export default async function PublicationQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const firmId = typeof sp.firm_id === "string" ? sp.firm_id : null;
  const periodId = typeof sp.period_id === "string" ? sp.period_id : null;

  const { data: firmsData } = await supabase.from("intake_firms").select("id,name").order("name");
  const firms = (firmsData ?? []) as Firm[];
  const selectedFirm = firmId
    ? (firms.find((f) => f.id === firmId) ?? null)
    : firms.length === 1
      ? firms[0]
      : null;

  if (!selectedFirm) {
    return (
      <div>
        <PageHeader
          title="Publication Queue"
          subtitle="Select a firm to see its content periods and eligible publication placements."
        />
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {firms.map((firm) => (
            <Link
              key={firm.id}
              href={`/admin/content-studio/publication-queue?firm_id=${firm.id}`}
              className="rounded border border-black/8 bg-white p-6 hover:border-sky-300 hover:bg-sky-50/30 transition-colors"
            >
              <div className="font-medium text-sm text-black/80">{firm.name ?? "Unnamed firm"}</div>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const { data: periodsData } = await supabase
    .from("content_periods")
    .select("id,theme,starts_on,ends_on,readiness_lifecycle")
    .eq("firm_id", selectedFirm.id)
    .order("starts_on", { ascending: false });
  const periods = (periodsData ?? []) as Period[];
  const selectedPeriod = periodId ? (periods.find((p) => p.id === periodId) ?? null) : null;

  if (!selectedPeriod) {
    return (
      <div>
        <PageHeader title="Publication Queue" subtitle={selectedFirm.name ?? "Unknown firm"} />
        <div className="mt-6 rounded border border-black/8 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-black/10">
            <div className="text-sm font-medium">Content periods</div>
            <div className="text-xs text-black/50 mt-1">Select a period to see its eligible placements.</div>
          </div>
          <div className="divide-y divide-black/5">
            {periods.length === 0 && (
              <div className="p-6 text-sm text-black/40">No content periods for {selectedFirm.name}.</div>
            )}
            {periods.map((period) => (
              <Link
                key={period.id}
                href={`/admin/content-studio/publication-queue?firm_id=${selectedFirm.id}&period_id=${period.id}`}
                className="p-4 flex items-center justify-between gap-4 hover:bg-black/[0.02] transition-colors"
              >
                <div>
                  <div className="font-medium text-sm">{period.theme ?? "Untitled period"}</div>
                  <div className="text-xs text-black/50 mt-1">
                    {formatDate(period.starts_on)} – {formatDate(period.ends_on)}
                  </div>
                </div>
                {lifecycleBadge(period.readiness_lifecycle)}
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const report = await loadPublicationPreflightForPeriod(selectedPeriod.id, selectedFirm.id);
  const placements = report?.placements ?? [];
  const counts: Record<string, number> = {};
  for (const p of placements) {
    const cat = roughCategory(p);
    counts[cat] = (counts[cat] ?? 0) + 1;
  }

  return (
    <div>
      <PageHeader
        title="Publication Queue"
        subtitle={`${selectedFirm.name ?? "Unknown firm"} — ${selectedPeriod.theme ?? "Untitled period"}`}
      />
      <div className="mt-2">
        <Link
          href={`/admin/content-studio/publication-queue?firm_id=${selectedFirm.id}`}
          className="text-xs text-sky-600 hover:underline"
        >
          ← All periods
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {lifecycleBadge(selectedPeriod.readiness_lifecycle)}
        <span className="text-xs text-black/50">
          {formatDate(selectedPeriod.starts_on)} – {formatDate(selectedPeriod.ends_on)}
        </span>
      </div>

      {selectedPeriod.readiness_lifecycle !== "enforced" && (
        <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          This period is not activated for readiness enforcement (
          {selectedPeriod.readiness_lifecycle === "legacy_unreconciled" ? "historical, not reconciled" : "setup required"}
          ). Every placement below will report blocked until an operator activates the period.
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-3">
        {(["ready", "already_published", "ambiguous_external_state", "blocked_content", "blocked_other"] as const).map(
          (cat) => (
            <div key={cat} className="rounded border border-black/8 bg-white p-4">
              <div className="text-xs uppercase tracking-wider text-black/50">{QUEUE_CATEGORY_LABEL[cat]}</div>
              <div className="mt-1 text-2xl font-semibold">{counts[cat] ?? 0}</div>
            </div>
          ),
        )}
      </div>

      {report && report.deliverablesWithNoPlacements.length > 0 && (
        <div className="mt-4 rounded border border-black/8 bg-white p-4">
          <div className="text-xs font-medium text-black/60 mb-2">
            {report.deliverablesWithNoPlacements.length} deliverable(s) with no placement yet
          </div>
          <ul className="text-xs text-black/50 list-disc list-inside space-y-1">
            {report.deliverablesWithNoPlacements.map((d) => (
              <li key={d.deliverableId}>{d.deliverableTitle}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 rounded border border-black/8 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-black/10">
          <div className="text-sm font-medium">Eligible placements</div>
          <div className="text-xs text-black/50 mt-1">
            One row per destination placement. Click a row to run its full dry preflight and view its execution
            manifest.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-black/50 border-b border-black/10 bg-black/[0.02]">
              <tr>
                <th className="text-left px-4 py-3">Deliverable</th>
                <th className="text-left">Destination</th>
                <th className="text-left">Locale</th>
                <th className="text-left">Path</th>
                <th className="text-left">Comments</th>
                <th className="text-left">Receipt</th>
                <th className="text-left">Status</th>
                <th className="px-4"></th>
              </tr>
            </thead>
            <tbody>
              {placements.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-black/40">
                    No placements in this period.
                  </td>
                </tr>
              )}
              {placements.map((p) => {
                const cat = roughCategory(p);
                return (
                  <tr key={p.placementId} className="border-b border-black/5">
                    <td className="px-4 py-3 max-w-xs truncate" title={p.deliverableTitle}>
                      {p.deliverableTitle}
                    </td>
                    <td className="text-black/60 whitespace-nowrap">{p.destination}</td>
                    <td className="text-black/60">{p.locale ?? <span className="text-black/30">—</span>}</td>
                    <td className="text-black/60 max-w-[10rem] truncate" title={p.intendedPath ?? undefined}>
                      {p.intendedPath ?? <span className="text-black/30">Not set</span>}
                    </td>
                    <td className="text-black/60">
                      {p.unresolvedCommentCount > 0 ? (
                        <span className="text-rose-600">{p.unresolvedCommentCount} open</span>
                      ) : (
                        <span className="text-black/30">0</span>
                      )}
                    </td>
                    <td className="text-black/60">
                      {p.currentReceipt ? (
                        <span className="text-xs">{p.currentReceipt.verificationState}</span>
                      ) : (
                        <span className="text-black/30 text-xs">None</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded text-xs font-medium ${QUEUE_CATEGORY_TONE[cat]}`}
                        title={p.reason ?? undefined}
                      >
                        {QUEUE_CATEGORY_LABEL[cat]}
                      </span>
                    </td>
                    <td className="px-4 text-right">
                      <Link
                        href={`/admin/content-studio/publication-queue/${p.placementId}?firm_id=${selectedFirm.id}&deliverable_id=${p.deliverableId}`}
                        className="text-sky-600 hover:underline text-xs whitespace-nowrap"
                      >
                        Run dry preflight →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
