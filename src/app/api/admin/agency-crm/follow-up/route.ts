import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import {
  activateAgencyFollowupJourney,
  approveAgencyFollowupMessage,
  approveAgencyFollowupTemplateVersion,
  createAgencyFollowupJourneyVersion,
  createAgencyFollowupEnrollment,
  createAgencyFollowupTemplateVersion,
  listAgencyFollowupConsole,
  pauseAgencyFollowupEnrollment,
  releaseAgencyFollowupEnrollment,
  setAgencyFollowupEligibility,
} from "@/lib/agency-followup-service";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isText(value: unknown, max = 2000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function authorizedActor(session: Awaited<ReturnType<typeof getOperatorSession>>) {
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!session.lawyer_id) return { response: NextResponse.json({ error: "Operator identity is required for audited follow-up actions." }, { status: 403 }) };
  return { actorId: session.lawyer_id };
}

function traceLocalFollowupProbe(host: string | null, stage: string, details: Record<string, unknown> = {}): void {
  if (!/^(127\.0\.0\.1|localhost):55435$/i.test(host ?? "")) return;
  console.info("[agency-followup-local-probe] " + JSON.stringify({ component: "handler", stage, ...details }));
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const host = request.headers.get("host");
  traceLocalFollowupProbe(host, "handler_enter", { method: "GET" });
  const authStartedAt = Date.now();
  const session = await getOperatorSession();
  traceLocalFollowupProbe(host, "auth_complete", {
    elapsedMs: Date.now() - authStartedAt,
    sessionPresent: Boolean(session),
    operatorIdentityPresent: Boolean(session?.lawyer_id),
  });
  const auth = authorizedActor(session);
  if ("response" in auth && auth.response) {
    traceLocalFollowupProbe(host, "handler_exit", { elapsedMs: Date.now() - startedAt, responseStatus: auth.response.status });
    return auth.response;
  }
  const listStartedAt = Date.now();
  traceLocalFollowupProbe(host, "crm_list_start");
  try {
    const result = await listAgencyFollowupConsole();
    traceLocalFollowupProbe(host, "crm_list_complete", { elapsedMs: Date.now() - listStartedAt });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    traceLocalFollowupProbe(host, "crm_list_failed", { elapsedMs: Date.now() - listStartedAt });
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = authorizedActor(await getOperatorSession());
  if ("response" in auth) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "enroll": {
        if (!isText(body.journeyId, 100) || !UUID.test(body.journeyId) || !isText(body.prospectId, 100) || !UUID.test(body.prospectId)) {
          return NextResponse.json({ error: "Choose a journey and one prospect." }, { status: 400 });
        }
        const result = await createAgencyFollowupEnrollment({ journeyId: body.journeyId, prospectId: body.prospectId, actorId: auth.actorId });
        return NextResponse.json(result, { status: 201 });
      }
      case "template_create": {
        if (!isText(body.templateKey, 120) || !isText(body.subject, 1000) || !isText(body.body, 20000)) {
          return NextResponse.json({ error: "Provide a template key, subject, and body within the supported lengths." }, { status: 400 });
        }
        const result = await createAgencyFollowupTemplateVersion({
          templateKey: body.templateKey,
          subject: body.subject,
          body: body.body,
          actorId: auth.actorId,
        });
        return NextResponse.json(result, { status: 201 });
      }
      case "template_approve": {
        if (!isText(body.templateVersionId, 100) || !UUID.test(body.templateVersionId)) {
          return NextResponse.json({ error: "Choose one template version to approve." }, { status: 400 });
        }
        await approveAgencyFollowupTemplateVersion({ templateVersionId: body.templateVersionId, actorId: auth.actorId });
        break;
      }
      case "journey_create": {
        if (!isText(body.journeyKey, 120) || !isText(body.name, 240) || !isText(body.timezone, 120) ||
            !isText(body.localWindowStart, 5) || !isText(body.localWindowEnd, 5) ||
            !Array.isArray(body.businessDays) || !Array.isArray(body.steps) ||
            typeof body.minimumSpacingHours !== "number") {
          return NextResponse.json({ error: "Provide journey identity, schedule settings, and ordered steps." }, { status: 400 });
        }
        const steps = body.steps.map((step) => {
          const value = step && typeof step === "object" ? step as Record<string, unknown> : {};
          return { templateVersionId: String(value.templateVersionId ?? ""), delayBusinessDays: Number(value.delayBusinessDays) };
        });
        const result = await createAgencyFollowupJourneyVersion({
          journeyKey: body.journeyKey,
          name: body.name,
          schedule: {
            timezone: body.timezone,
            businessDays: body.businessDays.map(Number),
            localWindowStart: body.localWindowStart,
            localWindowEnd: body.localWindowEnd,
            minimumSpacingHours: body.minimumSpacingHours,
          },
          steps,
          actorId: auth.actorId,
        });
        return NextResponse.json(result, { status: 201 });
      }
      case "journey_activate": {
        if (!isText(body.journeyId, 100) || !UUID.test(body.journeyId)) {
          return NextResponse.json({ error: "Choose one draft journey version to activate." }, { status: 400 });
        }
        await activateAgencyFollowupJourney({ journeyId: body.journeyId, actorId: auth.actorId });
        break;
      }
      case "eligibility": {
        if (!isText(body.enrollmentId, 100) || !UUID.test(body.enrollmentId) ||
            !["eligible", "ineligible", "unknown"].includes(String(body.state)) || !isText(body.evidenceRef)) {
          return NextResponse.json({ error: "Record one enrollment, a supported eligibility state, and its evidence." }, { status: 400 });
        }
        await setAgencyFollowupEligibility({ enrollmentId: body.enrollmentId, state: body.state as "eligible" | "ineligible" | "unknown", evidenceRef: body.evidenceRef, actorId: auth.actorId });
        break;
      }
      case "release": {
        if (!isText(body.enrollmentId, 100) || !UUID.test(body.enrollmentId) || !isText(body.basis)) {
          return NextResponse.json({ error: "Record one enrollment and its release basis." }, { status: 400 });
        }
        await releaseAgencyFollowupEnrollment({ enrollmentId: body.enrollmentId, basis: body.basis, actorId: auth.actorId });
        break;
      }
      case "approve": {
        if (!isText(body.enrollmentId, 100) || !UUID.test(body.enrollmentId) || !isText(body.messageId, 100) || !UUID.test(body.messageId)) {
          return NextResponse.json({ error: "Choose one enrollment and one message." }, { status: 400 });
        }
        await approveAgencyFollowupMessage({ enrollmentId: body.enrollmentId, messageId: body.messageId, actorId: auth.actorId });
        break;
      }
      case "pause": {
        if (!isText(body.enrollmentId, 100) || !UUID.test(body.enrollmentId) || !isText(body.reason)) {
          return NextResponse.json({ error: "Record one enrollment and a pause reason." }, { status: 400 });
        }
        await pauseAgencyFollowupEnrollment({ enrollmentId: body.enrollmentId, reason: body.reason, actorId: auth.actorId });
        break;
      }
      default:
        return NextResponse.json({ error: "Unsupported follow-up action." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
