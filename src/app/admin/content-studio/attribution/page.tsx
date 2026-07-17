// Content Performance (Content Studio's content-to-matter attribution
// surface, Phase 3 point 1). Read-only operator view: verified placements,
// receipt status, attributable enquiries by evidence-graded state,
// qualified-matter/outcome counts where the existing client_matters
// record supports them, and an explicit unknown/unattributed count.
// Never states or implies a deliverable "generated" a client -- only
// that enquiries have an evidence-graded connection. Follows this
// directory's existing convention (server component, supabaseAdmin,
// firm chosen via the sidebar switcher's ?firm_id= param).

import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { listCurrentAttributionForFirm } from "@/lib/content-attribution";
import { countByAttributionState, ATTRIBUTION_STATE_LABELS } from "@/lib/content-attribution-pure";
import type { AttributionState } from "@/lib/types";

export const dynamic = "force-dynamic";

type Firm = { id: string; name: string | null };
type Deliverable = { id: string; title: string; status: string };

const STATE_TONE: Record<AttributionState, string> = {
  known_first_touch: "bg-emerald-50 text-emerald-700",
  known_assisted: "bg-emerald-50 text-emerald-700",
  self_reported: "bg-sky-50 text-sky-700",
  offline_referral: "bg-amber-50 text-amber-700",
  unknown: "bg-black/5 text-black/50",
};

function StatePill({ state, count }: { state: AttributionState; count: number }) {
  if (count === 0) return null;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATE_TONE[state]}`}>
      {ATTRIBUTION_STATE_LABELS[state]}: {count}
    </span>
  );
}

export default async function ContentPerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const firmId = typeof sp.firm_id === "string" ? sp.firm_id : null;

  const { data: firmsData } = await supabase.from("intake_firms").select("id,name").order("name");
  const firms = (firmsData ?? []) as Firm[];
  const selected = firmId
    ? (firms.find((f) => f.id === firmId) ?? null)
    : firms.length === 1
      ? firms[0]
      : null;

  if (!selected) {
    return (
      <div>
        <PageHeader
          title="Content Performance"
          subtitle="Select a firm to see evidence-graded attribution for its published content."
        />
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {firms.map((firm) => (
            <Link
              key={firm.id}
              href={`/admin/content-studio/attribution?firm_id=${firm.id}`}
              className="rounded border border-black/8 bg-white p-6 hover:border-sky-300 hover:bg-sky-50/30 transition-colors"
            >
              <div className="font-medium text-sm text-black/80">{firm.name ?? "Unnamed firm"}</div>
            </Link>
          ))}
          {firms.length === 0 && (
            <div className="col-span-full p-8 text-center text-sm text-black/40">No firms configured.</div>
          )}
        </div>
      </div>
    );
  }

  const [{ data: deliverableRows }, current] = await Promise.all([
    supabase
      .from("content_deliverables")
      .select("id, title, status")
      .eq("firm_id", selected.id)
      .neq("status", "archived")
      .order("created_at", { ascending: false }),
    listCurrentAttributionForFirm(selected.id),
  ]);
  const deliverables = (deliverableRows ?? []) as Deliverable[];

  const byDeliverable = new Map<string, typeof current>();
  for (const row of current) {
    if (!row.deliverable_id) continue;
    const list = byDeliverable.get(row.deliverable_id) ?? [];
    list.push(row);
    byDeliverable.set(row.deliverable_id, list);
  }

  const firmTotals = countByAttributionState(current);
  const knownTotal = firmTotals.known_first_touch + firmTotals.known_assisted;

  return (
    <div>
      <PageHeader title="Content Performance" subtitle={selected.name ?? "Unknown firm"} />

      <div className="mt-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-black/50">Total enquiries with evidence</div>
            <div className="mt-2 text-2xl font-semibold">{current.length}</div>
          </div>
          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-black/50">Observed</div>
            <div className="mt-2 text-2xl font-semibold">{knownTotal}</div>
          </div>
          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-black/50">Self-reported / offline</div>
            <div className="mt-2 text-2xl font-semibold">{firmTotals.self_reported + firmTotals.offline_referral}</div>
          </div>
          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-xs uppercase tracking-wider text-black/50">Unknown / unattributed</div>
            <div className="mt-2 text-2xl font-semibold">{firmTotals.unknown}</div>
          </div>
        </div>

        <div className="rounded border border-black/8 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-black/10">
            <div className="text-sm font-medium">Deliverable Attribution</div>
            <div className="text-xs text-black/50 mt-1">
              Evidence-graded enquiries per deliverable. Counts, not causal claims.
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-black/50 border-b border-black/10 bg-black/[0.02]">
                <tr>
                  <th className="text-left px-4 py-3">Deliverable</th>
                  <th className="text-left">Status</th>
                  <th className="text-left px-4">Attribution evidence</th>
                  <th className="text-right px-4">Enquiries</th>
                </tr>
              </thead>
              <tbody>
                {deliverables.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-black/40">
                      No content deliverables yet for {selected.name}.
                    </td>
                  </tr>
                )}
                {deliverables.map((d) => {
                  const rows = byDeliverable.get(d.id) ?? [];
                  const counts = countByAttributionState(rows);
                  return (
                    <tr key={d.id} className="border-b border-black/5">
                      <td className="px-4 py-3">
                        <Link href={`/admin/content-studio/${d.id}`} className="text-sky-600 hover:underline font-medium">
                          {d.title}
                        </Link>
                      </td>
                      <td className="text-black/60 whitespace-nowrap">{d.status}</td>
                      <td className="px-4">
                        <div className="flex flex-wrap gap-1.5">
                          {rows.length === 0 ? (
                            <span className="text-black/30 text-xs">No evidence yet</span>
                          ) : (
                            (Object.keys(counts) as AttributionState[]).map((state) => (
                              <StatePill key={state} state={state} count={counts[state]} />
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 text-right">
                        {rows.length > 0 ? (
                          <Link
                            href={`/admin/content-studio/attribution/leads?firm_id=${selected.id}&deliverable_id=${d.id}`}
                            className="text-sky-600 hover:underline"
                          >
                            {rows.length}
                          </Link>
                        ) : (
                          <span className="text-black/30">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded border border-black/8 bg-white p-5">
          <Link
            href={`/admin/content-studio/attribution/leads?firm_id=${selected.id}`}
            className="text-sky-600 hover:underline text-sm font-medium"
          >
            View all attributed enquiries for {selected.name} →
          </Link>
        </div>
      </div>
    </div>
  );
}
