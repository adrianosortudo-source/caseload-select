import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import {
  listPieces,
  createPiece,
  getActiveStrategy,
} from "@/lib/content-studio";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/content-studio/pieces?firm_id=...
 * Lists content pieces for a firm, ordered by created_at desc, limit 50.
 */
export async function GET(req: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;

  const firmId = req.nextUrl.searchParams.get("firm_id");
  if (!firmId) {
    return NextResponse.json(
      { ok: false, error: "firm_id query param is required" },
      { status: 400 }
    );
  }

  const { data, error } = await listPieces(firmId, 50);
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, pieces: data });
}

/**
 * POST /api/admin/content-studio/pieces
 * Creates a new content piece. Snapshots the active strategy.
 * If calendar_slot_id is provided, marks that slot as briefed.
 */
export async function POST(req: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;

  const body = await req.json();
  const {
    firm_id,
    calendar_slot_id,
    title_working,
    format,
    language_mode,
    source_brief,
  } = body as {
    firm_id?: string;
    calendar_slot_id?: string;
    title_working?: string;
    format?: string;
    language_mode?: string;
    source_brief?: Record<string, unknown>;
  };

  if (!firm_id || !title_working || !format) {
    return NextResponse.json(
      { ok: false, error: "firm_id, title_working, and format are required" },
      { status: 400 }
    );
  }

  // Mirrors the content_pieces_format_check CHECK constraint
  // (supabase/migrations/20260626100200_content_studio_compliance_formats.sql).
  // Draft-time availability is gated separately in the draft route: formats
  // whose generator branch has not shipped are creatable and briefable here
  // but return 422 at draft time.
  const validFormats = [
    "counsel_note",
    "clause_in_the_margin",
    "decision_tool",
    "counsel_letter",
    "checklist",
    "landing_page",
    "paid_traffic_landing",
    "canonical_service_page",
    "review_request",
    "review_response",
  ];
  if (!validFormats.includes(format)) {
    return NextResponse.json(
      { ok: false, error: `format must be one of: ${validFormats.join(", ")}` },
      { status: 400 }
    );
  }

  // A calendar slot may only be briefed by its own firm. Validate ownership
  // before linking/mutating it, so a piece for firm A cannot consume firm B's
  // slot (service-role bypasses RLS, so this check is the only guard).
  if (calendar_slot_id) {
    const { data: slot } = await supabaseAdmin
      .from("content_calendar_slots")
      .select("id")
      .eq("id", calendar_slot_id)
      .eq("firm_id", firm_id)
      .maybeSingle();
    if (!slot) {
      return NextResponse.json(
        { ok: false, error: "calendar slot not found for this firm" },
        { status: 400 }
      );
    }
  }

  // Snapshot the active strategy for this firm
  const strategy = await getActiveStrategy(firm_id);
  const strategyId = strategy?.id ?? undefined;
  const strategyVersion = strategy?.version ?? undefined;

  const { data: piece, error } = await createPiece({
    firm_id,
    calendar_slot_id: calendar_slot_id || undefined,
    strategy_id: strategyId,
    strategy_version: strategyVersion,
    title_working,
    format,
    language_mode: language_mode || "en",
    source_brief: source_brief || undefined,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  // If created from a calendar slot, mark the slot as briefed
  if (calendar_slot_id) {
    await supabaseAdmin
      .from("content_calendar_slots")
      .update({ status: "briefed" })
      .eq("id", calendar_slot_id)
      .eq("firm_id", firm_id);
  }

  return NextResponse.json({ ok: true, piece }, { status: 201 });
}
