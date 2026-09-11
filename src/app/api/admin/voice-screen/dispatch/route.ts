import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { isCronAuthorized } from "@/lib/cron-auth";
import { dispatchInvitation, senderConfig } from "@/lib/voice-screen-sender";
import { database, liveConfig } from "@/lib/voice-screen-store";

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    const denied = await requireOperator(); if (denied) return denied;
    if (req.headers.get("origin") !== new URL(req.url).origin) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const config = liveConfig();
  if (!config || !senderConfig()) return NextResponse.json({ error: "sms_dispatch_disabled" }, { status: 503 });
  try {
    const db = await database();
    const { data, error } = await db.from("voice_screen_inquiries").select("id,voice_screen_outbox!inner(status)").eq("firm_id", config.firmId).eq("location_id", config.locationId).eq("agent_id", config.agentId).eq("voice_screen_outbox.status", "pending").order("created_at").limit(10);
    if (error) throw error;
    const results = [];
    for (const row of data ?? []) results.push({ id: row.id, ...await dispatchInvitation(row.id) });
    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "dispatch_reconciliation_required" }, { status: 503 }); }
}
