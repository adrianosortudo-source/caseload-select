import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { getPiece, getCurrentVersion } from "@/lib/content-studio";
import { checkLegalGateEntryCondition } from "@/lib/content-studio-gates";
import { addVersion } from "@/lib/deliverables";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  renderServicePagePreview,
  renderMarkdownToSafeHtml,
  type ServicePageBlock,
} from "@/lib/content-studio-structured";

export const dynamic = "force-dynamic";

const SEND_TO_REVIEW_ACTOR = {
  role: "operator" as const,
  id: null,
  name: "Content Studio (automated)",
  email: null,
};

/**
 * POST /api/admin/content-studio/pieces/[id]/send-to-review
 *
 * Explicit action (Ses.17 WP-2, the revision loop): posts the piece's
 * current EN version as a NEW version of its already-linked deliverable, so
 * the firm's lawyer sees the update. This is the only route in Content
 * Studio that touches an existing deliverable after its first creation at
 * the legal_gate advance; regeneration and manual edits alone never post
 * anywhere by themselves.
 *
 * Requires: a linked deliverable (piece.deliverable_id set) and a zero-fail
 * validation run on the current EN version, same entry condition as
 * advancing to legal_gate in the first place. addVersion({ silent: true })
 * means no notification fires; the version-drift guard in deliverables.ts
 * then does the correct thing on its own: the deliverable returns to
 * in_review and any stale approval pointer clears, so a re-approval is
 * required and it always covers what the lawyer actually sees.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { id } = await params;

  const { data: piece, error: pieceErr } = await getPiece(id);
  if (pieceErr || !piece) {
    return NextResponse.json(
      { ok: false, error: pieceErr?.message ?? "Piece not found" },
      { status: pieceErr ? 500 : 404 }
    );
  }

  if (!piece.deliverable_id) {
    return NextResponse.json(
      {
        ok: false,
        error: "This piece has no linked deliverable yet. Advance it to legal_gate first.",
      },
      { status: 422 }
    );
  }

  const version = await getCurrentVersion(id, "en");
  let latestValidationResults: { status: string }[] | null = null;
  if (version) {
    const { data: run } = await supabaseAdmin
      .from("content_ai_runs")
      .select("result")
      .eq("piece_version_id", version.id)
      .eq("run_type", "validate_deterministic")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const result = run?.result as { validators?: { status: string }[] } | undefined;
    latestValidationResults = result?.validators ?? null;
  }

  const entryCheck = checkLegalGateEntryCondition({
    hasCurrentVersion: !!version,
    latestValidationResults,
  });
  if (!entryCheck.ok) {
    return NextResponse.json(
      { ok: false, error: entryCheck.reason, code: "send_to_review_blocked" },
      { status: 422 }
    );
  }

  const enHtml =
    piece.format === "canonical_service_page"
      ? renderServicePagePreview(
          (version!.body_structured as ServicePageBlock[] | null) ?? [],
          (version!.seo_metadata as Record<string, unknown> | null) ?? undefined
        ).html
      : renderMarkdownToSafeHtml(version!.body_markdown as string | null);

  // Ses.17 WP-4: when a current PT version exists, append it beneath the EN
  // content behind a labeled divider. One sign-off then covers both
  // languages; the drift guard in deliverables.ts already forces
  // re-approval whenever any new version (EN or PT) posts after an approval.
  const ptVersion = piece.language_mode === "bilingual" ? await getCurrentVersion(id, "pt") : null;
  const ptHtml = ptVersion
    ? piece.format === "canonical_service_page"
      ? renderServicePagePreview(
          (ptVersion.body_structured as ServicePageBlock[] | null) ?? [],
          (ptVersion.seo_metadata as Record<string, unknown> | null) ?? undefined
        ).html
      : renderMarkdownToSafeHtml(ptVersion.body_markdown as string | null)
    : null;

  const html = ptHtml
    ? `${enHtml}\n<hr>\n<h2>Portuguese version</h2>\n${ptHtml}`
    : enHtml;

  const versioned = await addVersion({
    deliverableId: piece.deliverable_id,
    firmId: piece.firm_id,
    bodyHtml: html,
    storagePath: null,
    assetMime: null,
    assetSizeBytes: null,
    assetName: null,
    note: "Sent for review from Content Studio (revision).",
    actor: SEND_TO_REVIEW_ACTOR,
    silent: true,
  });
  if (!versioned.ok) {
    return NextResponse.json(
      { ok: false, error: `Failed to post the update to the deliverable: ${versioned.error}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    piece_id: id,
    deliverable_id: piece.deliverable_id,
    deliverable_version: versioned.version,
  });
}
