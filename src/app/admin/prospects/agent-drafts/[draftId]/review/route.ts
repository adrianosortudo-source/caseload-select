import { NextResponse } from "next/server";

import { getGtaProspectAgentDraftReviewManifest } from "@/lib/gta-prospect-agent-draft-inbox";
import { getOperatorSession } from "@/lib/portal-auth";
import { getPreviewQaReadSession } from "@/lib/preview-qa-auth";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

/** Full, bounded package manifest for an operator or preview QA reader. */
export async function GET(request: Request, context: { params: Promise<{ draftId: string }> }) {
  if (!(await getOperatorSession() ?? await getPreviewQaReadSession(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  }
  const { draftId } = await context.params;
  try {
    const manifest = await getGtaProspectAgentDraftReviewManifest({ draftId });
    if (!manifest) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
    return NextResponse.json({ manifest }, { headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The staged package could not be loaded.";
    const status = /must be a UUID\.|exceeds the review limit\./.test(message) ? 400 : 503;
    return NextResponse.json({ error: message }, { status, headers: noStore });
  }
}
