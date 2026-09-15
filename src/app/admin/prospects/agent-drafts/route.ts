import { NextResponse } from "next/server";

import { applyGtaProspectAgentDraft, listGtaProspectAgentDraftsForOperator } from "@/lib/gta-prospect-agent-draft-inbox";
import { getOperatorSession } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

async function operatorAuthorized(): Promise<boolean> {
  return Boolean(await getOperatorSession());
}

/** Operator-only list. It exposes validation receipts, never secrets or CRM data. */
export async function GET() {
  if (!await operatorAuthorized()) return json({ error: "Unauthorized" }, 401);
  try { return json({ drafts: await listGtaProspectAgentDraftsForOperator() }); }
  catch (error) {
    console.error("[gta-prospect-agent-draft-inbox] list failed", error);
    return json({ error: "The AI draft inbox could not be loaded." }, 503);
  }
}

/** Explicit final operator action. It rereads and revalidates the staged package before import. */
export async function PUT(request: Request) {
  if (!await operatorAuthorized()) return json({ error: "Unauthorized" }, 401);
  let payload: unknown;
  try { payload = await request.json(); } catch { return json({ error: "Expected a JSON object with draftId." }, 400); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof (payload as Record<string, unknown>).draftId !== "string") return json({ error: "Expected a JSON object with draftId." }, 400);
  try {
    const result = await applyGtaProspectAgentDraft({ draftId: (payload as { draftId: string }).draftId });
    if (result.state === "review_changed") return json({ error: "The current ledger changed this draft review. Refresh it, inspect the revised result, and confirm again.", draftId: result.draftId, summary: result.review }, 409);
    return json({ mode: result.state, draftId: result.draftId, summary: result.review, receipts: result.receipts });
  } catch (error) {
    console.error("[gta-prospect-agent-draft-inbox] apply failed", error);
    return json({ error: error instanceof Error ? error.message : "The staged AI package could not be imported.", note: "No CRM, outreach, contact, form, or chat action was attempted." }, 503);
  }
}
