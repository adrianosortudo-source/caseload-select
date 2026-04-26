/**
 * GET /api/memo/[sessionId]
 *
 * Returns the Case Intake Memo for a session.
 * Used by the firm portal (lead detail memo tab) and the intake widget
 * (for polling after Round 3 completes, if needed).
 *
 * Auth:
 *  - Portal: verified via portal session cookie (firm must own the session).
 *  - Widget: session_id is a sufficient secret for the widget context (no PII in URL).
 *
 * Returns:
 *   { memo_text: string; generated_at: string } | { pending: true } | { error: string }
 */

import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getPortalSession } from "@/lib/portal-auth";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await ctx.params;

  // Determine caller context: portal (has session cookie) or widget (query param auth)
  const portalSession = await getPortalSession().catch(() => null);
  const url = new URL(req.url);
  const widgetMode = url.searchParams.get("widget") === "1";

  const { data: session, error } = await supabase
    .from("intake_sessions")
    .select("id, firm_id, memo_text, memo_generated_at")
    .eq("id", sessionId)
    .single();

  if (error || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Portal auth: firm must own the session
  if (!widgetMode) {
    if (!portalSession || portalSession.firm_id !== session.firm_id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!session.memo_text || !session.memo_generated_at) {
    return NextResponse.json({ pending: true });
  }

  return NextResponse.json({
    memo_text: session.memo_text,
    generated_at: session.memo_generated_at,
  });
}
