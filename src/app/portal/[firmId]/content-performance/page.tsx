/**
 * /portal/[firmId]/content-performance
 *
 * Content Performance -- client/lawyer-safe view (Phase 3 point 2).
 * Same auth posture as the Deliverables hub: operator or matching
 * firm-lawyer session, client sessions excluded at page level.
 *
 * Aggregate counts and evidence-graded language only. No raw
 * screened_leads rows, no contact details, no operator evidence notes.
 * "N enquiries have a self-reported connection to this content," never
 * "this content generated N clients."
 */

import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { listCurrentAttributionForFirm } from "@/lib/content-attribution";
import { countByAttributionState, hasSufficientSampleSize, buildClientSafeAttributionSentences } from "@/lib/content-attribution-pure";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Deliverable = { id: string; title: string; status: string; approved_at: string | null };

export default async function ContentPerformancePortalPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const { firmId } = await params;

  const session = await getPortalSession();
  if (!session || session.role === "client") {
    redirect("/portal/login");
  }

  const [current, { data: deliverableRows }] = await Promise.all([
    listCurrentAttributionForFirm(firmId),
    supabase.from("content_deliverables").select("id, title, status, approved_at").eq("firm_id", firmId),
  ]);
  const deliverableById = new Map(((deliverableRows ?? []) as Deliverable[]).map((d) => [d.id, d]));

  const byDeliverable = new Map<string, typeof current>();
  for (const row of current) {
    if (!row.deliverable_id) continue;
    const list = byDeliverable.get(row.deliverable_id) ?? [];
    list.push(row);
    byDeliverable.set(row.deliverable_id, list);
  }

  const firmCounts = countByAttributionState(current);
  const firmSufficient = hasSufficientSampleSize(current.length);

  return (
    <div className="space-y-6">
      <div className="rounded border border-black/8 bg-white p-6">
        <h1 className="text-lg font-semibold text-navy">Content Performance</h1>
        <p className="text-sm text-black/60 mt-1">
          How enquiries connect to your published content, based only on evidence we actually observed or that a
          prospect told us directly.
        </p>
        {!firmSufficient && (
          <p className="text-xs text-amber-700 mt-3">
            Not enough enquiries yet ({current.length}) for a reliable pattern across your content overall.
          </p>
        )}
      </div>

      <div className="rounded border border-black/8 bg-white overflow-hidden">
        <div className="divide-y divide-black/5">
          {Array.from(byDeliverable.entries()).length === 0 && (
            <div className="p-6 text-sm text-black/40">
              No published content has evidence-bearing enquiries yet.
            </div>
          )}
          {Array.from(byDeliverable.entries()).map(([deliverableId, rows]) => {
            const deliverable = deliverableById.get(deliverableId);
            const counts = countByAttributionState(rows);
            const sentences = buildClientSafeAttributionSentences(counts);
            const sufficient = hasSufficientSampleSize(rows.length);
            return (
              <div key={deliverableId} className="p-5">
                <div className="font-medium text-sm text-black/80">{deliverable?.title ?? "Untitled"}</div>
                {!sufficient && (
                  <div className="text-xs text-black/40 mt-1">
                    Insufficient evidence yet ({rows.length} {rows.length === 1 ? "enquiry" : "enquiries"}) for a
                    reliable pattern.
                  </div>
                )}
                <ul className="mt-2 space-y-1">
                  {sentences.length === 0 ? (
                    <li className="text-xs text-black/40">No evidence-bearing enquiries yet.</li>
                  ) : (
                    sentences.map((s) => (
                      <li key={s} className="text-xs text-black/70">
                        {s}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
