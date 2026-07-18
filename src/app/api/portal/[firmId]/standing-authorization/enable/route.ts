/**
 * POST /api/portal/[firmId]/standing-authorization/enable
 *
 * Turns standing publishing authorization ON. LAWYER ONLY: auth is
 * getFirmSession(firmId), which structurally cannot admit an operator or
 * client session (see lib/portal-auth.ts) -- there is no operator-facing
 * path to this route at all, and set_standing_publishing_authorization
 * independently rejects a non-lawyer actor_role at the database layer as
 * defense in depth.
 *
 * The exact authorization wording is assembled server-side
 * (buildStandingAuthorizationText) and is never accepted from the request
 * body -- the client only confirms it, never supplies it, so the frozen
 * copy in the append-only event row can never diverge from the canonical
 * text for the policy version in force.
 *
 * Body: { notification_preference: "per_publication" | "weekly_digest", agreed: true }
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirmSession } from "@/lib/portal-auth";
import {
  enableStandingAuthorization,
  getFirmDisplayName,
  resolveFirmLawyerIdentity,
  type NotificationPreference,
} from "@/lib/standing-publishing-authorization";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getFirmSession(firmId);
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { notification_preference?: unknown; agreed?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body.agreed !== true) {
    return NextResponse.json(
      { error: "you must confirm the authorization statement to turn this on" },
      { status: 400 },
    );
  }
  const notificationPreference =
    body.notification_preference === "per_publication" || body.notification_preference === "weekly_digest"
      ? (body.notification_preference as NotificationPreference)
      : null;
  if (!notificationPreference) {
    return NextResponse.json(
      { error: "notification_preference must be 'per_publication' or 'weekly_digest'" },
      { status: 400 },
    );
  }

  const actor = await resolveFirmLawyerIdentity(firmId, session);
  if (!actor.email) {
    return NextResponse.json(
      { error: "a lawyer email is required on file before enabling standing authorization; contact the operator" },
      { status: 400 },
    );
  }

  const firmName = await getFirmDisplayName(firmId);
  if (!firmName) {
    return NextResponse.json({ error: "firm not found" }, { status: 404 });
  }

  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const result = await enableStandingAuthorization({
    firmId,
    firmName,
    actor,
    notificationPreference,
    ipAddress,
    userAgent,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, eventId: result.eventId, effectiveAt: result.effectiveAt });
}
