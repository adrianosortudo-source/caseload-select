/**
 * POST /api/admin/leads/[id]/purge
 *
 * PIPEDA right-to-deletion endpoint. Immediately anonymizes all PII
 * for the specified lead on written request from the data subject.
 *
 * Auth: Bearer CRON_SECRET (operator only — never expose to clients)
 *
 * Logs the purge to console for the 3-year audit trail required by PIPEDA.
 */

import { NextRequest, NextResponse } from "next/server";
import { purgeLeadPii } from "@/lib/data-retention";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await purgeLeadPii(id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    lead_id: id,
    purged_at: new Date().toISOString(),
    note: "PII anonymized per PIPEDA s. 4.5.3. Scoring data retained for aggregate reporting.",
  });
}
