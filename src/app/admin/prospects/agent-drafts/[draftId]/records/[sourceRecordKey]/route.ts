import { NextResponse } from "next/server";

import { getGtaProspectAgentDraftRecordReview } from "@/lib/gta-prospect-agent-draft-inbox";
import { getOperatorSession } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

/** Operator-only bounded projection of one staged public-evidence record. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ draftId: string; sourceRecordKey: string }> },
) {
  if (!await getOperatorSession()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
  const { draftId, sourceRecordKey } = await context.params;
  try {
    const record = await getGtaProspectAgentDraftRecordReview({ draftId, sourceRecordKey });
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    return NextResponse.json({ record }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The staged record could not be loaded.";
    const status = /is invalid\.$/.test(message) ? 400 : 503;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
