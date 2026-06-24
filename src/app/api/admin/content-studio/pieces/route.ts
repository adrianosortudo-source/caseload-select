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

  const validFormats = [
    "counsel_note",
    "clause_in_the_margin",
    "decision_tool",
    "counsel_letter",
  ];
  if (!validFormats.includes(format)) {
    return NextResponse.json(
      { ok: false, error: `format must be one of: ${validFormats.join(", ")}` },
      { status: 400 }
    );
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
      .eq("id", calendar_slot_id);
  }

  return NextResponse.json({ ok: true, piece }, { status: 201 });
}
