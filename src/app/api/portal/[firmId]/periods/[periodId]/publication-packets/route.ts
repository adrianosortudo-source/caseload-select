/**
 * GET /api/portal/[firmId]/periods/[periodId]/publication-packets
 *
 * Read-only, operator-only (same requireOperator() gate as its sibling
 * .../publication-preflight route). Returns the Canonical Publication
 * Packet for every deliverable x placement in this period, plus a period
 * reconciliation summary (calibration report: "report published, pending,
 * failed, and blocked items with one precise reason per exception").
 *
 * This route makes no write of any kind. It does not publish, place,
 * approve, or notify -- it only assembles and reports (see
 * publication-packet.ts's own header comment for the full content-policy
 * boundary this composes with).
 *
 * siteOrigin (required query param): the canonical site origin used only
 * for the CTA-reachability check (see publication-packet-loader.ts) --
 * this repo has no per-firm domain field to auto-discover one from, so the
 * caller supplies it explicitly rather than this route guessing or
 * hardcoding a single firm's domain.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { loadPublicationPacketsForPeriod } from "@/lib/publication-packet-loader";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firmId, periodId } = await params;
  const siteOrigin = req.nextUrl.searchParams.get("siteOrigin");
  if (!siteOrigin) {
    return NextResponse.json({ error: "siteOrigin query param is required" }, { status: 400 });
  }

  const result = await loadPublicationPacketsForPeriod(periodId, firmId, { siteOrigin });
  if (!result) return NextResponse.json({ error: "period not found for this firm, or has no deliverables" }, { status: 404 });

  return NextResponse.json({ ok: true, ...result });
}
