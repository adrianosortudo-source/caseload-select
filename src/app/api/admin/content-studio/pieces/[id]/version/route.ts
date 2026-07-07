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
import { buildArticleSchemaBlock, buildMarkdownSeoMetadata } from "@/lib/content-studio-prompt";

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
  const strategy = await getActiveStrategy(piece.firm_id);

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

    // Carry the prior version's seo_metadata forward, applying any edited
    // title/meta_description. Codex audit F9 (2026-07-07): the schema.* JSON-LD
    // blocks (FAQPage, Article, etc.) were assembled from the ORIGINAL blocks at
    // generation time; an edit to FAQ answers or section bodies makes them
    // diverge from the visible content. Recomputing structured schema from
    // edited canonical blocks is non-trivial, so mark it stale instead: the
    // export route refuses a stale-schema version (regenerate to rebuild), and
    // renderReviewPayload surfaces the staleness to the reviewing lawyer.
    const priorSeo = (priorVersion.seo_metadata as Record<string, unknown> | null) ?? {};
    const seoMetadata: Record<string, unknown> = {
      ...priorSeo,
      ...(typeof body.seo_title === "string" && body.seo_title.trim()
        ? { title: body.seo_title.trim() }
        : {}),
      ...(typeof body.seo_meta_description === "string" && body.seo_meta_description.trim()
        ? { meta_description: body.seo_meta_description.trim() }
        : {}),
      schema_stale: true,
      schema_stale_reason: "operator_edit",
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
    // Codex audit F9 (2026-07-07): RECOMPUTE the Markdown Article schema +
    // last-updated marker from the EDITED body instead of carrying the prior
    // version's forward. The Article headline comes from the first heading and
    // dateModified/generated_at from now, so an edited body never ships with a
    // stale headline or last-updated date. (Cheap and correct here, unlike the
    // canonical FAQPage rebuild, which is marked stale above.) Falls back to
    // carrying prior metadata forward, marked stale, only if no active strategy
    // is available to recompute against.
    let seoMetadata: Record<string, unknown> | undefined;
    if (strategy) {
      const generatedAt = new Date().toISOString();
      const articleSchema = buildArticleSchemaBlock({
        strategy,
        titleWorking: piece.title_working,
        generatedText: validated.body,
        generatedAt,
        language,
      });
      const sourceBriefForMeta =
        piece.source_brief && typeof piece.source_brief === "object"
          ? (piece.source_brief as Record<string, unknown>)
          : {};
      seoMetadata = buildMarkdownSeoMetadata({
        sourceBrief: sourceBriefForMeta,
        articleSchema,
        generatedAt,
      });
    } else {
      const priorSeo = (priorVersion.seo_metadata as Record<string, unknown> | null) ?? {};
      seoMetadata = { ...priorSeo, schema_stale: true, schema_stale_reason: "operator_edit" };
    }
    const { data: version, error: versionErr } = await createPieceVersion({
      piece_id: id,
      version_number: versionNumber,
      language,
      body_markdown: validated.body,
      seo_metadata: seoMetadata,
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

  // Auto-validate the edit. Ses.17 WP-4: runAndRecordValidation now branches
  // internally on language, running the reduced PT battery for Portuguese
  // edits instead of the English-pattern batteries.
  let validationSummary: unknown = null;
  {
    if (strategy && created) {
      const sourceBrief =
        piece.source_brief && typeof piece.source_brief === "object"
          ? (piece.source_brief as Record<string, unknown>)
          : undefined;
      const outcome = await runAndRecordValidation({
        pieceId: id,
        firmId: piece.firm_id,
        format: piece.format,
        language,
        version: created,
        sourceBrief,
        strategy,
      });
      if (outcome.ok) validationSummary = outcome.outcome.summary;
    }
  }

  return NextResponse.json({ ok: true, version: created, validation_summary: validationSummary });
}
