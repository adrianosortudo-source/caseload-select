/**
 * POST /api/portal/[firmId]/standing-authorization/disable
 *
 * Turns standing publishing authorization OFF. LAWYER ONLY (see enable/
 * route.ts for the auth rationale, identical here). Takes effect
 * immediately for future publication decisions only: it does not revoke
 * or falsify the prior authorization event, does not unpublish existing
 * content, and does not alter any prior approval or publication record --
 * it simply appends a new 'disabled' event, which is what every future
 * claim_placement_for_publish call reads as "no active standing
 * authorization" from this point forward.
 *
 * Body: { reason?: string, agreed: true }
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirmSession } from "@/lib/portal-auth";
import { disableStandingAuthorization, resolveFirmLawyerIdentity } from "@/lib/standing-publishing-authorization";

const MAX_REASON_LENGTH = 2000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { reason?: unknown; agreed?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body.agreed !== true) {
    return NextResponse.json(
      { error: "you must confirm to turn this off" },
      { status: 400 },
    );
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, MAX_REASON_LENGTH)
      : null;

  const actor = await resolveFirmLawyerIdentity(firmId, session);
  if (!actor.email) {
    return NextResponse.json(
      { error: "a lawyer email is required on file before changing standing authorization; contact the operator" },
      { status: 400 },
    );
  }

  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const result = await disableStandingAuthorization({ firmId, actor, reason, ipAddress, userAgent });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, eventId: result.eventId, effectiveAt: result.effectiveAt });
}
