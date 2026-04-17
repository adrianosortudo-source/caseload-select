/**
 * POST /api/screen/round3/start
 *
 * Marks round3_started_at on the session so the stalled-round3 cron
 * can detect abandoned Round 3 sessions after 2 hours.
 *
 * Non-fatal — widget fires this and ignores failures.
 * Body: { session_id: string }
 */

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { session_id?: string };
    if (!body.session_id) return NextResponse.json({ ok: true });

    await supabase
      .from("intake_sessions")
      .update({ round3_started_at: new Date().toISOString() })
      .eq("id", body.session_id)
      .is("round3_started_at", null); // only set once

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // always 200 — non-fatal
  }
}
