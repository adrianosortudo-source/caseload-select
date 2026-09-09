import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { database, liveConfig } from "@/lib/voice-screen-store";

export async function GET() {
  const denied = await requireOperator(); if (denied) return denied;
  const config = liveConfig(); if (!config) return NextResponse.json({ error: "parallel_journey_disabled" }, { status: 503 });
  try {
    const db = await database();
    const { data, error } = await db.from("voice_screen_inquiries").select("id,caller_facts,status,human_status,created_at,voice_screen_outbox(status)")
      .eq("firm_id", config.firmId).eq("location_id", config.locationId).eq("agent_id", config.agentId).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ inquiries: (data ?? []).map(row => ({ id: row.id, callerName: row.caller_facts.callerName, broadNeed: row.caller_facts.broadNeed, urgency: row.caller_facts.urgency, status: row.status, humanStatus: row.human_status, createdAt: row.created_at, invitation: row.voice_screen_outbox })) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "queue_unavailable" }, { status: 503 }); }
}

export async function POST(req: NextRequest) {
  const denied = await requireOperator(); if (denied) return denied;
  if (req.headers.get("origin") !== new URL(req.url).origin) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const config = liveConfig(); if (!config) return NextResponse.json({ error: "parallel_journey_disabled" }, { status: 503 });
  try {
    const { id, action, contactId, confirm } = await req.json();
    const db = await database();
    if (action === "reconcile_dispatch") {
      const { data, error } = await db.rpc("v2s_reconcile_stale_dispatch", { p_firm_id: config.firmId, p_location_id: config.locationId, p_agent_id: config.agentId });
      if (error || typeof data !== "number") throw new Error("reconciliation_failed");
      return NextResponse.json({ reconciled: data }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "erase_subject") {
      if (confirm !== "ERASE" || typeof contactId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(contactId)) return NextResponse.json({ error: "invalid_subject" }, { status: 400 });
      const { data, error } = await db.rpc("v2s_erase_subject", { p_firm_id: config.firmId, p_location_id: config.locationId, p_contact_id: contactId });
      if (error || typeof data !== "number") throw new Error("subject_erase_failed");
      return NextResponse.json({ erased: data }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action !== undefined && action !== "takeover") return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "invalid_inquiry" }, { status: 400 });
    const { data: scoped, error: scopeError } = await db.from("voice_screen_inquiries").select("id").eq("id", id).eq("firm_id", config.firmId).eq("location_id", config.locationId).eq("agent_id", config.agentId).maybeSingle();
    if (scopeError) throw scopeError;
    if (!scoped) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const { data: takenOver, error } = await db.rpc("v2s_takeover", { p_id: id }); if (error) throw error;
    if (takenOver !== true) return NextResponse.json({ error: "already_changed" }, { status: 409 });
    return NextResponse.json({ takenOver: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "takeover_unavailable" }, { status: 503 }); }
}
