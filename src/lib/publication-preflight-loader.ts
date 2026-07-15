/**
 * Workstream 7: I/O loader for the preflight report. Assembles the same
 * period-scoped deliverable readiness evaluation loadPeriodPublicationReadiness
 * already does (publication-readiness-loader.ts), plus the placement and
 * current-receipt layer that evaluator doesn't know about, and hands it all
 * to the pure buildPreflightReport (publication-preflight.ts). Thin wrapper;
 * every branching decision lives in the pure function.
 */

import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { loadPeriodPublicationReadiness } from "@/lib/publication-readiness-loader";
import { listCurrentReceiptsByPlacementForDeliverable } from "@/lib/publication-receipts";
import { buildPreflightReport, type PreflightPeriodReport } from "@/lib/publication-preflight";
import type {
  ContentDeliverable,
  ContentPeriod,
  ContentPlacement,
  DeliverableComment,
  PublicationReceipt,
} from "@/lib/types";

export async function loadPublicationPreflightForPeriod(
  periodId: string,
  firmId: string,
): Promise<PreflightPeriodReport | null> {
  const { data: period } = await supabase
    .from("content_periods")
    .select("*")
    .eq("id", periodId)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (!period) return null;
  const periodRow = period as ContentPeriod;

  const [readiness, { data: deliverables }] = await Promise.all([
    loadPeriodPublicationReadiness(periodId, firmId),
    supabase.from("content_deliverables").select("*").eq("period_id", periodId).eq("firm_id", firmId),
  ]);
  const readyByDeliverableId: Record<string, boolean> = {};
  for (const r of readiness) readyByDeliverableId[r.deliverableId] = r.ready;

  const rows = (deliverables ?? []) as ContentDeliverable[];
  const activeIds = rows.filter((d) => d.status !== "archived").map((d) => d.id);

  const [comments, placementsByDeliverableId, receiptsByPlacementParts] = await Promise.all([
    activeIds.length
      ? supabase
          .from("deliverable_comments")
          .select("*")
          .in("deliverable_id", activeIds)
          .then(({ data }) => (data ?? []) as DeliverableComment[])
      : Promise.resolve([] as DeliverableComment[]),
    activeIds.length
      ? supabase
          .from("content_placements")
          .select("*")
          .in("deliverable_id", activeIds)
          .then(({ data }) => {
            const byDeliverable: Record<string, ContentPlacement[]> = {};
            for (const p of (data ?? []) as ContentPlacement[]) {
              const list = byDeliverable[p.deliverable_id] ?? [];
              list.push(p);
              byDeliverable[p.deliverable_id] = list;
            }
            return byDeliverable;
          })
      : Promise.resolve({} as Record<string, ContentPlacement[]>),
    Promise.all(activeIds.map((id) => listCurrentReceiptsByPlacementForDeliverable(id))),
  ]);

  const commentsByDeliverableId: Record<string, DeliverableComment[]> = {};
  for (const c of comments) {
    const list = commentsByDeliverableId[c.deliverable_id] ?? [];
    list.push(c);
    commentsByDeliverableId[c.deliverable_id] = list;
  }

  const currentReceiptsByPlacementId: Record<string, PublicationReceipt | null> = {};
  for (const part of receiptsByPlacementParts) Object.assign(currentReceiptsByPlacementId, part);

  return buildPreflightReport({
    periodId,
    periodLifecycle: periodRow.readiness_lifecycle,
    deliverables: rows,
    readyByDeliverableId,
    commentsByDeliverableId,
    placementsByDeliverableId,
    currentReceiptsByPlacementId,
  });
}
