/**
 * POST /api/portal/[firmId]/about
 *
 * Operator-only. Sets the firm's standing "About this content" explainer shown
 * above the deliverables list in the portal. body_html is sanitised to the
 * deliverable/explainer allowlist before storage. Mirrors the
 * content-plan-settings route's auth + response shape.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { setFirmAbout } from "@/lib/firm-about";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { body_html?: unknown; links?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.body_html !== "string") {
    return NextResponse.json({ error: "body_html is required" }, { status: 400 });
  }

  const result = await setFirmAbout({
    firmId,
    bodyHtml: body.body_html,
    links: body.links,
    updatedBy: "operator",
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, about: result.about });
}
