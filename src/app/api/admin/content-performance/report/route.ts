/**
 * GET /api/admin/content-performance/report?firm_id=&from=&to=
 *
 * Content Performance / Content-to-Matter Attribution (Phase 4):
 * operator reporting layer for a firm and date range. Modest and
 * truthful, not a generic dashboard -- observation is kept separate
 * from recommendation, and volume too small to mean anything is
 * flagged rather than narrated.
 *
 * Never guarantees rankings, AI citations, enquiries, matters, or
 * revenue. "what_we_learned" is generated only from evidence actually
 * observed in-range, and is empty (not padded with speculation) when
 * the sample is below MIN_SAMPLE_FOR_OBSERVATION.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { listCurrentAttributionForFirm } from "@/lib/content-attribution";
import {
  countByAttributionState,
  hasSufficientSampleSize,
  MIN_SAMPLE_FOR_OBSERVATION,
  ATTRIBUTION_STATE_LABELS,
} from "@/lib/content-attribution-pure";
import type { AttributionState } from "@/lib/types";

export async function GET(req: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;

  const url = new URL(req.url);
  const firmId = url.searchParams.get("firm_id");
  if (!firmId) {
    return NextResponse.json({ error: "firm_id query parameter is required" }, { status: 400 });
  }
  const fromIso = url.searchParams.get("from") ?? undefined;
  const toIso = url.searchParams.get("to") ?? undefined;

  const [current, placementRows, deliverableRows] = await Promise.all([
    listCurrentAttributionForFirm(firmId, { fromIso, toIso }),
    supabase
      .from("content_placements")
      .select("id, deliverable_id, destination, locale, state")
      .eq("firm_id", firmId),
    supabase
      .from("content_deliverables")
      .select("id, title, status, approved_at")
      .eq("firm_id", firmId),
  ]);

  const breakdown = countByAttributionState(current);
  const sufficient = hasSufficientSampleSize(current.length);
  const outcomeSignals = current.reduce<Record<string, number>>((acc, row) => {
    if (!row.matter_stage) return acc;
    acc[row.matter_stage] = (acc[row.matter_stage] ?? 0) + 1;
    return acc;
  }, {});

  const whatWeLearned: string[] = [];
  if (sufficient) {
    const total = current.length;
    (Object.keys(breakdown) as AttributionState[]).forEach((state) => {
      const n = breakdown[state];
      if (n === 0) return;
      const pct = Math.round((n / total) * 100);
      whatWeLearned.push(
        `${pct}% of enquiries in range (${n} of ${total}) are ${ATTRIBUTION_STATE_LABELS[state].toLowerCase()}.`,
      );
    });
  }

  return NextResponse.json({
    ok: true,
    firm_id: firmId,
    range: { from: fromIso ?? null, to: toIso ?? null },
    published_deliverables: deliverableRows.data ?? [],
    placements: placementRows.data ?? [],
    enquiries: {
      total: current.length,
      attribution_breakdown: breakdown,
      unknown_volume: breakdown.unknown,
      sufficient_sample: sufficient,
      min_sample_for_observation: MIN_SAMPLE_FOR_OBSERVATION,
    },
    outcome_signals: outcomeSignals,
    what_we_learned: whatWeLearned,
  });
}
