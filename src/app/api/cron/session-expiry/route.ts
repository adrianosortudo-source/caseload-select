import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/session-expiry
 *
 * Marks in_progress intake sessions as expired when they are older than 24 hours.
 * Runs every 2 hours via Vercel cron.
 *
 * Intent: sessions that stall mid-intake (abandoned widget, dropped connection)
 * should not remain in_progress indefinitely. Expiry keeps the session table clean
 * and prevents stale data from affecting scoring lookups.
 *
 * Sessions with band B or C that expire are flagged so a re-engagement follow-up
 * can be triggered downstream (S8).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Fetch stale in_progress sessions
  const { data: staleSessions, error: fetchErr } = await supabase
    .from("intake_sessions")
    .select("id, band, firm_id")
    .eq("status", "in_progress")
    .lt("created_at", cutoff);

  if (fetchErr) {
    console.error("[session-expiry] fetch error:", fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!staleSessions || staleSessions.length === 0) {
    return NextResponse.json({ ok: true, expired: 0 });
  }

  const ids = staleSessions.map((s) => s.id);

  const { error: updateErr } = await supabase
    .from("intake_sessions")
    .update({ status: "expired" })
    .in("id", ids);

  if (updateErr) {
    console.error("[session-expiry] update error:", updateErr.message);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Log qualified abandoned sessions (B/C) for future re-engagement (S8)
  const qualified = staleSessions.filter((s) => s.band === "B" || s.band === "C");
  if (qualified.length > 0) {
    console.log(
      `[session-expiry] ${qualified.length} qualified session(s) expired (band B/C) — re-engagement pending S8:`,
      qualified.map((s) => s.id)
    );
  }

  return NextResponse.json({
    ok: true,
    expired: staleSessions.length,
    qualified_abandoned: qualified.length,
  });
}
