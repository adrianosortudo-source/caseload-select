import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { getPiece, updatePiece, getCurrentVersion } from "@/lib/content-studio";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const WORKFLOW_GATES = [
  "discovery",
  "position",
  "draft",
  "legal_gate",
  "authoring",
  "production",
] as const;

type WorkflowGate = (typeof WORKFLOW_GATES)[number];

/**
 * GET /api/admin/content-studio/pieces/[id]
 * Returns the piece, its current EN and PT versions, and recent AI runs.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { id } = await params;

  const { data: piece, error } = await getPiece(id);
  if (error || !piece) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Piece not found" },
      { status: error ? 500 : 404 }
    );
  }

  // Fetch current EN version
  const currentEn = await getCurrentVersion(id, "en");

  // Fetch current PT version (if bilingual)
  let currentPt = null;
  if (piece.language_mode === "bilingual") {
    currentPt = await getCurrentVersion(id, "pt");
  }

  // Fetch latest AI runs for this piece (limit 5)
  const { data: aiRuns } = await supabaseAdmin
    .from("content_ai_runs")
    .select("*")
    .eq("piece_id", id)
    .order("created_at", { ascending: false })
    .limit(5);

  return NextResponse.json({
    ok: true,
    piece,
    current_version_en: currentEn ?? null,
    current_version_pt: currentPt,
    ai_runs: aiRuns ?? [],
  });
}

/**
 * PATCH /api/admin/content-studio/pieces/[id]
 * Updates piece fields. Enforces forward-only workflow gate transitions.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();

  const allowedFields = [
    "title_working",
    "source_brief",
    "workflow_gate",
    "status",
    "owner_name",
    "review_date",
    "ship_checks",
  ];

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { ok: false, error: "No valid fields to update" },
      { status: 400 }
    );
  }

  // If workflow_gate is being changed, validate forward-only transition
  if ("workflow_gate" in updates) {
    const { data: currentPiece, error: fetchErr } = await getPiece(id);
    if (fetchErr || !currentPiece) {
      return NextResponse.json(
        { ok: false, error: fetchErr?.message ?? "Piece not found" },
        { status: fetchErr ? 500 : 404 }
      );
    }

    const currentGate = currentPiece.workflow_gate as WorkflowGate;
    const newGate = updates.workflow_gate as WorkflowGate;

    const currentIndex = WORKFLOW_GATES.indexOf(currentGate);
    const newIndex = WORKFLOW_GATES.indexOf(newGate);

    if (newIndex < 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid workflow_gate. Must be one of: ${WORKFLOW_GATES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (newIndex <= currentIndex) {
      return NextResponse.json(
        {
          ok: false,
          error: `Workflow gate can only advance forward. Current: ${currentGate}, requested: ${newGate}`,
        },
        { status: 422 }
      );
    }
  }

  const { data: updated, error } = await updatePiece(id, updates);
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, piece: updated });
}
