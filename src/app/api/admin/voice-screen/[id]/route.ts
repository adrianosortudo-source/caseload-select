import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { database, liveConfig, type Inquiry } from "@/lib/voice-screen-store";
import { buildReport } from "@/lib/screen-engine/report";

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator(); if (denied) return denied;
  const config = liveConfig(); if (!config) return NextResponse.json({ error: "parallel_journey_disabled" }, { status: 503 });
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "invalid_inquiry" }, { status: 400 });
    const db = await database();
    const { data, error } = await db.from("voice_screen_inquiries").select("*").eq("id", id).eq("firm_id", config.firmId).eq("location_id", config.locationId).eq("agent_id", config.agentId).maybeSingle();
    if (error) throw error; if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const inquiry = data as Inquiry;
    return NextResponse.json({ id: inquiry.id, call: inquiry.caller_facts, answers: inquiry.answers, status: inquiry.status, humanStatus: inquiry.human_status, report: buildReport(inquiry.engine_state) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "brief_unavailable" }, { status: 503 }); }
}
