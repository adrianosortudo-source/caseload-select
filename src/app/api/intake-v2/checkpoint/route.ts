/**
 * POST /api/intake-v2/checkpoint
 *
 * Best-effort progress checkpoint for the web widget (qualification audit
 * F2/F6/item 5, 2026-07-02). The widget fires this after every answered
 * turn so an abandoned session leaves a trace: today, a lead who quits
 * before contact capture is invisible, unlike Meta channels which persist
 * multi-turn state.
 *
 * Body: { firmId, lead_id, engine_state, utm_source?, utm_medium?,
 *         utm_campaign?, utm_term?, utm_content?, referrer? }
 *
 * Always returns 200 on any recoverable condition (demo mode, unknown
 * firm, oversized payload) so a failure here can never surface as an
 * error in the widget UI; this is telemetry, not the intake path.
 *
 * CORS + rate limiting mirror /api/intake-v2 (same cross-origin surface,
 * same 'intake' rate bucket: this endpoint fires more often per session
 * but does no LLM work and no screened_leads write, so sharing the
 * bucket is a deliberate simplification, not a new bucket to configure).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { originAllowed } from "@/lib/intake-v2-security";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import { checkpointWebSession } from "@/lib/web-intake-session-store";
import type { EngineState } from "@/lib/screen-engine/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LEAD_ID_LEN = 120;
const MAX_ENGINE_STATE_BYTES = 200_000; // 200 KB; the full brief is ~250 KB, engine_state is a subset
const MAX_UTM_FIELD_LEN = 200;
const MAX_REFERRER_LEN = 2_048;

interface CheckpointBody {
  firmId?: string;
  lead_id?: string;
  engine_state?: unknown;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  referrer?: string | null;
}

function okOptStrCapped(v: unknown, maxLen: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > maxLen ? null : trimmed;
}

export async function POST(req: NextRequest) {
  const originCheck = await originAllowed(req);
  const requestOrigin = req.headers.get("origin");
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (originCheck.ok) {
    corsHeaders["Access-Control-Allow-Origin"] = requestOrigin ?? "*";
  }
  if (!originCheck.ok) {
    return NextResponse.json(
      { error: "origin not allowed", reason: originCheck.reason },
      { status: 403, headers: corsHeaders },
    );
  }

  const ip = ipFromRequest(req);
  const rl = await checkRateLimit("intake", ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate limited", retry_after_seconds: Math.ceil((rl.reset - Date.now()) / 1000) },
      { status: 429, headers: { ...corsHeaders, ...rateLimitHeaders(rl) } },
    );
  }

  let body: CheckpointBody;
  try {
    body = (await req.json()) as CheckpointBody;
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_json" }, { status: 200, headers: corsHeaders });
  }

  const firmId = (body.firmId ?? "").trim();
  if (!firmId || firmId === "demo_firm" || !UUID_RE.test(firmId)) {
    return NextResponse.json({ ok: false, reason: "demo_or_no_firm" }, { status: 200, headers: corsHeaders });
  }

  const leadId = (body.lead_id ?? "").trim();
  if (!leadId || leadId.length > MAX_LEAD_ID_LEN) {
    return NextResponse.json({ ok: false, reason: "invalid_lead_id" }, { status: 200, headers: corsHeaders });
  }

  if (
    body.engine_state === null ||
    typeof body.engine_state !== "object" ||
    Array.isArray(body.engine_state)
  ) {
    return NextResponse.json({ ok: false, reason: "invalid_engine_state" }, { status: 200, headers: corsHeaders });
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(body.engine_state);
  } catch {
    return NextResponse.json({ ok: false, reason: "unserializable_engine_state" }, { status: 200, headers: corsHeaders });
  }
  if (serialized.length > MAX_ENGINE_STATE_BYTES) {
    return NextResponse.json({ ok: false, reason: "engine_state_too_large" }, { status: 200, headers: corsHeaders });
  }

  const { data: firm, error: firmErr } = await supabase
    .from("intake_firms")
    .select("id")
    .eq("id", firmId)
    .maybeSingle();
  if (firmErr || !firm) {
    return NextResponse.json({ ok: false, reason: "firm_not_found" }, { status: 200, headers: corsHeaders });
  }

  const result = await checkpointWebSession({
    firmId,
    leadId,
    engineState: body.engine_state as EngineState,
    utm_source: okOptStrCapped(body.utm_source, MAX_UTM_FIELD_LEN),
    utm_medium: okOptStrCapped(body.utm_medium, MAX_UTM_FIELD_LEN),
    utm_campaign: okOptStrCapped(body.utm_campaign, MAX_UTM_FIELD_LEN),
    utm_term: okOptStrCapped(body.utm_term, MAX_UTM_FIELD_LEN),
    utm_content: okOptStrCapped(body.utm_content, MAX_UTM_FIELD_LEN),
    referrer: okOptStrCapped(body.referrer, MAX_REFERRER_LEN),
  });

  return NextResponse.json(
    { ok: result.ok, skipped: result.skipped, error: result.error },
    { status: 200, headers: corsHeaders },
  );
}

export async function OPTIONS(req: NextRequest) {
  const originCheck = await originAllowed(req);
  const requestOrigin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (originCheck.ok) headers["Access-Control-Allow-Origin"] = requestOrigin ?? "*";
  return new NextResponse(null, { status: 204, headers });
}
