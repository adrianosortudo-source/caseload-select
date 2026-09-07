import { NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { buildGtaProspectImportPlan } from "@/lib/gta-prospect-research-import";

export const dynamic = "force-dynamic";

/**
 * Operator-only, zero-write validation endpoint for the internal GTA research
 * ledger. This is deliberately dry-run-only: persistence stays in the
 * server-side CLI after its explicit confirmation gate, never in the browser.
 */
export async function POST(request: Request) {
  if (!(await getOperatorSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body with a records array." }, { status: 400 });
  }
  const records = payload && typeof payload === "object" && Array.isArray((payload as { records?: unknown }).records)
    ? (payload as { records: unknown[] }).records
    : null;
  if (!records) return NextResponse.json({ error: "Expected a records array." }, { status: 400 });
  if (records.length > 2_000) return NextResponse.json({ error: "At most 2,000 research records may be validated at once." }, { status: 413 });

  const plan = await buildGtaProspectImportPlan(records);
  return NextResponse.json({
    mode: "dry_run",
    sourceSha256: plan.sourceSha256,
    accepted: plan.accepted.length,
    rejected: plan.rejected.map(({ issues }) => issues),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
