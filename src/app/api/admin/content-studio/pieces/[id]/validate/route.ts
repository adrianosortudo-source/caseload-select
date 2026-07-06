import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import {
  getPiece,
  getCurrentVersion,
  getActiveStrategy,
  runAndRecordValidation,
} from "@/lib/content-studio";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/content-studio/pieces/[id]/validate
 * Runs deterministic validators against the current EN version of the piece.
 * Records the run in content_ai_runs.
 *
 * canonical_service_page is structured output (content-studio-structured.ts):
 * its version has body_structured + seo_metadata and an EMPTY body_markdown
 * by design, so it takes a separate branch through
 * runCanonicalServicePageValidators (content-validators.ts, wired 2026-07-02)
 * instead of the Markdown-based runDeterministicValidators. Every other
 * format is unchanged.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { id } = await params;

  // Load the piece
  const { data: piece, error: pieceErr } = await getPiece(id);
  if (pieceErr || !piece) {
    return NextResponse.json(
      { ok: false, error: pieceErr?.message ?? "Piece not found" },
      { status: pieceErr ? 500 : 404 }
    );
  }

  // Load current EN version
  const version = await getCurrentVersion(id, "en");
  if (!version) {
    return NextResponse.json(
      { ok: false, error: "No current EN version found. Create a draft first." },
      { status: 404 }
    );
  }

  // Load the firm's active strategy for validator config
  const strategy = await getActiveStrategy(piece.firm_id);
  if (!strategy) {
    return NextResponse.json(
      {
        ok: false,
        error: "No active content strategy found for this firm.",
      },
      { status: 422 }
    );
  }

  const sourceBrief =
    piece.source_brief && typeof piece.source_brief === "object"
      ? (piece.source_brief as Record<string, unknown>)
      : undefined;

  const outcome = await runAndRecordValidation({
    pieceId: id,
    firmId: piece.firm_id,
    format: piece.format,
    version,
    sourceBrief,
    strategy,
  });

  if (!outcome.ok) {
    return NextResponse.json(
      { ok: false, error: outcome.error, code: outcome.code },
      { status: 422 }
    );
  }

  return NextResponse.json({
    ok: true,
    piece_id: id,
    version_id: version.id,
    summary: outcome.outcome.summary,
    results: outcome.outcome.results,
  });
}
