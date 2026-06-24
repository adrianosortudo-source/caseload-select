import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import {
  getPiece,
  getCurrentVersion,
  getActiveStrategy,
  buildValidatorConfig,
  recordValidationRun,
} from "@/lib/content-studio";
import { runDeterministicValidators } from "@/lib/content-validators";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/content-studio/pieces/[id]/validate
 * Runs deterministic validators against the current EN version of the piece.
 * Records the run in content_ai_runs.
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

  if (!version.body_markdown || version.body_markdown.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "Version body is empty. Nothing to validate." },
      { status: 422 }
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

  // Build the validator config from the strategy and piece format
  const config = buildValidatorConfig(strategy, piece.format);

  // Run all deterministic validators
  const sourceBrief =
    piece.source_brief && typeof piece.source_brief === "object"
      ? (piece.source_brief as Record<string, unknown>)
      : undefined;

  const results = runDeterministicValidators(
    version.body_markdown,
    config,
    sourceBrief
  );

  // Record the validation run
  const { error: recordErr } = await recordValidationRun({
    piece_version_id: version.id,
    firm_id: piece.firm_id,
    results: results.map((r) => ({
      key: r.key,
      status: r.status,
      severity: r.severity,
      findings: r.findings,
    })),
  });

  if (recordErr) {
    console.error("Failed to record validation run:", recordErr);
    // Still return results even if recording failed
  }

  const failCount = results.filter((r) => r.status === "fail").length;
  const warnCount = results.filter((r) => r.status === "warn").length;

  return NextResponse.json({
    ok: true,
    piece_id: id,
    version_id: version.id,
    summary: {
      total: results.length,
      pass: results.filter((r) => r.status === "pass").length,
      fail: failCount,
      warn: warnCount,
      verdict: failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass",
    },
    results,
  });
}
