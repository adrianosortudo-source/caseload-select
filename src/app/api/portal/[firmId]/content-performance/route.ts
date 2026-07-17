/**
 * GET /api/portal/[firmId]/content-performance
 *
 * Content Performance / Content-to-Matter Attribution (Phase 3, point 2):
 * client/lawyer-safe portal view. Same auth posture as the Tier 1
 * Partner Dashboard (/api/portal/[firmId]/dashboard) -- lawyer-surface
 * data, client-role sessions excluded.
 *
 * Returns aggregate counts only: no raw screened_leads rows, no contact
 * details, no lead notes or intake narrative, no operator-only evidence
 * notes. Deliverable identity (title, published placements, dates) is
 * shareable; enquiry-level detail is not. See buildClientSafeAttributionSentences
 * in content-attribution-pure.ts for the exact wording rule this
 * endpoint's counts feed: "N enquiries have a self-reported connection
 * to this content," never "this content generated N clients."
 */

import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { listCurrentAttributionForFirm } from "@/lib/content-attribution";
import { countByAttributionState, hasSufficientSampleSize, buildClientSafeAttributionSentences } from "@/lib/content-attribution-pure";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await ctx.params;

  const session = await getPortalSession();
  const isAuthorized = !!session && session.role !== "client" && session.firm_id === firmId;
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const fromIso = url.searchParams.get("from") ?? undefined;
  const toIso = url.searchParams.get("to") ?? undefined;

  const current = await listCurrentAttributionForFirm(firmId, { fromIso, toIso });

  const { data: deliverableRows } = await supabase
    .from("content_deliverables")
    .select("id, title, status, approved_at")
    .eq("firm_id", firmId);
  const deliverableById = new Map((deliverableRows ?? []).map((d) => [d.id as string, d]));

  const byDeliverable = new Map<string, typeof current>();
  for (const row of current) {
    if (!row.deliverable_id) continue;
    const list = byDeliverable.get(row.deliverable_id) ?? [];
    list.push(row);
    byDeliverable.set(row.deliverable_id, list);
  }

  const deliverables = Array.from(byDeliverable.entries()).map(([deliverableId, rows]) => {
    const counts = countByAttributionState(rows);
    return {
      deliverable_id: deliverableId,
      title: (deliverableById.get(deliverableId)?.title as string | undefined) ?? "Untitled",
      total_enquiries: rows.length,
      attribution_breakdown: counts,
      sufficient_sample: hasSufficientSampleSize(rows.length),
      sentences: buildClientSafeAttributionSentences(counts),
    };
  });

  const firmTotals = countByAttributionState(current);

  return NextResponse.json({
    ok: true,
    range: { from: fromIso ?? null, to: toIso ?? null },
    firm_totals: {
      total_enquiries: current.length,
      attribution_breakdown: firmTotals,
      sufficient_sample: hasSufficientSampleSize(current.length),
    },
    deliverables,
  });
}
