import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import {
  getPiece,
  getCurrentVersion,
  getActiveStrategy,
  buildValidatorConfig,
  recordValidationRun,
} from "@/lib/content-studio";
import {
  runDeterministicValidators,
  runCanonicalServicePageValidators,
  type ValidatorResult,
  type CanonicalServicePageValidationContext,
} from "@/lib/content-validators";
import type { ServicePageBlock } from "@/lib/content-studio-structured";

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

  let results: ValidatorResult[];

  if (piece.format === "canonical_service_page") {
    const blocks = version.body_structured as ServicePageBlock[] | null | undefined;
    if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This canonical_service_page version has no body_structured content, so it cannot be validated as a structured page. It was likely created before the structured-output generator shipped, or a generation attempt failed partway. Regenerate the draft.",
          code: "structured_body_missing",
        },
        { status: 422 }
      );
    }

    const seoMetadata =
      (version.seo_metadata as Record<string, unknown> | null | undefined) ?? undefined;

    // Prefer seo_metadata (the snapshot captured at generation time for THIS
    // version) over piece.source_brief (which may have been edited since).
    // internal_link_targets is the exception: it is the set of links OFFERED
    // to the generator and only ever lived on the brief, never snapshotted.
    const context: CanonicalServicePageValidationContext = {
      primaryQuery: (seoMetadata?.primary_query as string | null | undefined) ?? undefined,
      answerSummary: (seoMetadata?.answer_summary as string | null | undefined) ?? undefined,
      jurisdiction: (seoMetadata?.jurisdiction as string | null | undefined) ?? undefined,
      serviceArea:
        (seoMetadata?.service_area as string | string[] | null | undefined) ?? undefined,
      title: (seoMetadata?.title as string | null | undefined) ?? undefined,
      internalLinkTargets: sourceBrief?.internal_link_targets as
        | Array<{ url: string; anchor_text_hint?: string; relation?: string }>
        | undefined,
    };

    results = runCanonicalServicePageValidators(blocks, seoMetadata, context);
  } else {
    if (!version.body_markdown || version.body_markdown.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: "Version body is empty. Nothing to validate." },
        { status: 422 }
      );
    }

    // Build the validator config from the strategy and piece format
    const config = buildValidatorConfig(strategy, piece.format);

    results = runDeterministicValidators(version.body_markdown, config, sourceBrief);
  }

  // Record the validation run
  const { error: recordErr } = await recordValidationRun({
    piece_id: id,
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
