import { NextResponse } from "next/server";

import { getGtaProspectAgentDraftRecordReview } from "@/lib/gta-prospect-agent-draft-inbox";
import { getOperatorSession } from "@/lib/portal-auth";
import { getPreviewQaReadSession } from "@/lib/preview-qa-auth";

export const dynamic = "force-dynamic";

/** Bounded staged-record projection for an operator or preview QA reader. */
export async function GET(
  request: Request,
  context: { params: Promise<{ draftId: string; sourceRecordKey: string }> },
) {
  if (!(await getOperatorSession() ?? await getPreviewQaReadSession(request))) {
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
