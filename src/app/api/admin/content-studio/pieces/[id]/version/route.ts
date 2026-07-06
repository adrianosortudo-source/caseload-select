import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireOperator } from "@/lib/admin-auth";
import {
  getPiece,
  getCurrentVersion,
  getNextVersionNumber,
  createPieceVersion,
  getActiveStrategy,
  runAndRecordValidation,
} from "@/lib/content-studio";
import {
  validateEditedMarkdownBody,
  validateEditedServicePageBlocks,
} from "@/lib/content-studio-edit";
import { flattenServicePageToPlainText } from "@/lib/content-studio-structured";

export const dynamic = "force-dynamic";

function hashString(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/**
 * PUT /api/admin/content-studio/pieces/[id]/version
 *
 * Operator editing (Ses.17 WP-2, the revision loop). Saves edited content as
 * a NEW version, never mutating an existing version row (createPieceVersion
 * already flips is_current on the prior row). Runs the validate pass
 * automatically and returns its summary, so the operator sees right away
 * whether the edit introduced a compliance regression.
 *
 * This route does not touch the linked deliverable. Posting the edit for
 * the firm's lawyer to see is the separate, explicit send-to-review action
 * (POST .../send-to-review), so a half-finished edit never reaches review.
 *
 * Body: { language?: "en" | "pt" (default "en"),
 *         body_markdown?: string,                     // Markdown formats
 *         blocks?: ServicePageBlock[],                 // canonical_service_page
 *         seo_title?: string, seo_meta_description?: string } // structured only
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();
  const language = body.language === "pt" ? "pt" : "en";

  const { data: piece, error: pieceErr } = await getPiece(id);
  if (pieceErr || !piece) {
    return NextResponse.json(
      { ok: false, error: pieceErr?.message ?? "Piece not found" },
      { status: pieceErr ? 500 : 404 }
    );
  }

  if (language === "pt" && piece.language_mode !== "bilingual") {
    return NextResponse.json(
      { ok: false, error: "This piece is not bilingual; it has no Portuguese version to edit." },
      { status: 400 }
    );
  }

  const priorVersion = await getCurrentVersion(id, language);
  if (!priorVersion) {
    return NextResponse.json(
      { ok: false, error: `No current ${language} version to edit. Generate a draft first.` },
      { status: 422 }
    );
  }

  const versionNumber = await getNextVersionNumber(id, language);

  let created: { id: string; body_markdown: string | null; body_structured: unknown[] | null; seo_metadata: Record<string, unknown> | null } | null =
    null;

  if (piece.format === "canonical_service_page") {
    const validated = validateEditedServicePageBlocks(body.blocks);
    if (!validated.valid) {
      return NextResponse.json(
        { ok: false, error: "Invalid blocks payload.", details: validated.errors },
        { status: 400 }
      );
    }

    // Carry the prior version's seo_metadata forward untouched except for
    // title/meta_description when the operator edited them. The schema.*
    // JSON-LD blocks were assembled from strategy facts (NAP, credentials)
    // at generation time and stay valid; nothing here recomputes them.
    const priorSeo = (priorVersion.seo_metadata as Record<string, unknown> | null) ?? {};
    const seoMetadata: Record<string, unknown> = {
      ...priorSeo,
      ...(typeof body.seo_title === "string" && body.seo_title.trim()
        ? { title: body.seo_title.trim() }
        : {}),
      ...(typeof body.seo_meta_description === "string" && body.seo_meta_description.trim()
        ? { meta_description: body.seo_meta_description.trim() }
        : {}),
    };

    const flatText = flattenServicePageToPlainText(validated.blocks);
    const { data: version, error: versionErr } = await createPieceVersion({
      piece_id: id,
      version_number: versionNumber,
      language,
      body_structured: validated.blocks,
      seo_metadata: seoMetadata,
      text_hash: hashString(flatText),
      created_by: "operator",
    });
    if (versionErr) {
      return NextResponse.json(
        { ok: false, error: `Failed to save version: ${versionErr.message}` },
        { status: 500 }
      );
    }
    created = version;
  } else {
    const validated = validateEditedMarkdownBody(body.body_markdown);
    if (!validated.valid) {
      return NextResponse.json(
        { ok: false, error: "Invalid body_markdown.", details: validated.errors },
        { status: 400 }
      );
    }
    // Ses.17 WP-3 integration fix: carry the prior version's seo_metadata
    // (Article JSON-LD + last-updated marker, added by the draft route)
    // forward unchanged, same as the canonical_service_page branch above.
    // Before this, an operator edit silently dropped that metadata because
    // this branch predates WP-3's Markdown seo_metadata assembly.
    const priorSeo = (priorVersion.seo_metadata as Record<string, unknown> | null) ?? undefined;
    const { data: version, error: versionErr } = await createPieceVersion({
      piece_id: id,
      version_number: versionNumber,
      language,
      body_markdown: validated.body,
      seo_metadata: priorSeo,
      text_hash: hashString(validated.body),
      created_by: "operator",
    });
    if (versionErr) {
      return NextResponse.json(
        { ok: false, error: `Failed to save version: ${versionErr.message}` },
        { status: 500 }
      );
    }
    created = version;
  }

  // Auto-validate the edit (EN only; there is no Portuguese validator battery
  // wired here yet outside runPtValidators, added in WP-4).
  let validationSummary: unknown = null;
  if (language === "en") {
    const strategy = await getActiveStrategy(piece.firm_id);
    if (strategy && created) {
      const sourceBrief =
        piece.source_brief && typeof piece.source_brief === "object"
          ? (piece.source_brief as Record<string, unknown>)
          : undefined;
      const outcome = await runAndRecordValidation({
        pieceId: id,
        firmId: piece.firm_id,
        format: piece.format,
        version: created,
        sourceBrief,
        strategy,
      });
      if (outcome.ok) validationSummary = outcome.outcome.summary;
    }
  }

  return NextResponse.json({ ok: true, version: created, validation_summary: validationSummary });
}
