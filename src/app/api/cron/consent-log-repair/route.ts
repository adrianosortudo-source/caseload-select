/**
 * GET /api/cron/consent-log-repair
 *
 * Repair sweep for the consent_log audit trail (H5/DR-075 follow-up). Finds
 * screened_leads rows whose email consent state is 'explicit' or 'implied'
 * but which have no corresponding consent_log row (the original write at
 * intake time failed and was swallowed by design), and reconstructs the
 * missing row from data already persisted on the lead.
 *
 * Auth: Bearer CRON_SECRET or PG_CRON_TOKEN, same as every other /api/cron/*
 * route (see lib/cron-auth.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runConsentLogRepairSweep } from "@/lib/consent-log-repair";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runConsentLogRepairSweep();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
