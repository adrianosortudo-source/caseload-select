import "server-only";

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runAgencyFollowupDispatcher } from "@/lib/agency-followup-service";
import { resolveAgencyFollowupSendConfig } from "@/lib/agency-followup-send-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

/** Authenticated bounded Agency follow-up worker. No client-controlled targets or batch size. */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return response({ error: "unauthorized" }, 401);

  const invocationId = randomUUID();
  const config = resolveAgencyFollowupSendConfig();
  if (config.mode === "off" || !config.ready) {
    return response({ ok: true, invocationId, mode: config.mode, dispatched: false, claimed: 0 });
  }

  try {
    const result = await runAgencyFollowupDispatcher({
      workerId: `agency-cron:${invocationId}`,
      now: new Date().toISOString(),
    });
    return response({ ok: true, invocationId, mode: config.mode, dispatched: true, ...result });
  } catch {
    return response({ ok: false, invocationId, error: "agency_followup_dispatch_failed" }, 500);
  }
}
