import { NextRequest, NextResponse } from "next/server";
import { getCrmAgentReadSession } from "@/lib/crm-agent-auth";
import { getOperatorSession } from "@/lib/portal-auth";
import {
  AgencyFollowupOptInError,
  listAgencyFollowupOptInHistory,
  listAgencyFollowupOptInHistoryForAgent,
  recordAgencyFollowupOptInEvent,
} from "@/lib/agency-followup-opt-in";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCES = new Set(["subject_web_form", "subject_email", "signed_document", "recorded_verbal_consent", "other_verified_evidence"]);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;

export async function GET(request: NextRequest) {
  const session = await getOperatorSession();
  const agent = !session && await getCrmAgentReadSession(request);
  if (!session && !agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session && !session.lawyer_id) return NextResponse.json({ error: "Operator identity is required for audited opt-in actions." }, { status: 403 });
  const prospectId = request.nextUrl.searchParams.get("prospectId");
  if (!prospectId || !UUID.test(prospectId)) {
    return NextResponse.json({ error: "Provide a valid prospectId." }, { status: 400 });
  }
  try {
    const events = agent
      ? await listAgencyFollowupOptInHistoryForAgent(request, prospectId)
      : await listAgencyFollowupOptInHistory({ prospectId, actorOperatorId: session!.lawyer_id! });
    return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AgencyFollowupOptInError) {
      if (error.kind === "invalid") return NextResponse.json({ error: error.message }, { status: 400 });
      if (error.kind === "conflict") return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to load Agency follow-up opt-in history." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getOperatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.lawyer_id) return NextResponse.json({ error: "Operator identity is required for audited opt-in actions." }, { status: 403 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }
  const body = payload as Record<string, unknown>;
  if (!UUID.test(String(body.prospectId ?? "")) || !["opt_in_granted", "opt_in_withdrawn"].includes(String(body.eventType)) ||
      !text(body.capturedAt, 100) || !Number.isFinite(Date.parse(body.capturedAt)) || !SOURCES.has(String(body.captureSource)) ||
      !text(body.consentTextVersion, 200) || !SHA256.test(String(body.consentTextSha256 ?? "")) ||
      !text(body.evidenceReference, 2000) || !SHA256.test(String(body.evidenceSha256 ?? "")) ||
      !text(body.idempotencyKey, 500) || body.idempotencyKey.trim() !== body.idempotencyKey || body.evidenceReviewed !== true) {
    return NextResponse.json({ error: "Provide a valid prospect, capture details, reviewed consent and evidence references, and idempotency key." }, { status: 400 });
  }
  try {
    const result = await recordAgencyFollowupOptInEvent({
      prospectId: String(body.prospectId), actorOperatorId: session.lawyer_id,
      eventType: body.eventType as "opt_in_granted" | "opt_in_withdrawn", capturedAt: body.capturedAt as string,
      captureSource: body.captureSource as "subject_web_form" | "subject_email" | "signed_document" | "recorded_verbal_consent" | "other_verified_evidence",
      consentTextVersion: body.consentTextVersion as string, consentTextSha256: body.consentTextSha256 as string,
      evidenceReference: body.evidenceReference as string, evidenceSha256: body.evidenceSha256 as string,
      idempotencyKey: body.idempotencyKey as string, evidenceReviewed: true,
    });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AgencyFollowupOptInError) {
      if (error.kind === "invalid") return NextResponse.json({ error: error.message }, { status: 400 });
      if (error.kind === "conflict") return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to record Agency follow-up opt-in evidence." }, { status: 500 });
  }
}
