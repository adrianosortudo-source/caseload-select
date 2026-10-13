import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import {
  approveAgencyFollowupMessage,
  createAgencyFollowupEnrollment,
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

async function authorizedActor() {
  const session = await getOperatorSession();
  if (!session) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!session.lawyer_id) return { response: NextResponse.json({ error: "Operator identity is required for audited follow-up actions." }, { status: 403 }) };
  return { actorId: session.lawyer_id };
}

export async function GET() {
  const auth = await authorizedActor();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json(await listAgencyFollowupConsole(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizedActor();
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
