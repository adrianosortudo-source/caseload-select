import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { getPiece, getCurrentVersion } from "@/lib/content-studio";
import { checkLegalGateEntryCondition } from "@/lib/content-studio-gates";
import { addVersion } from "@/lib/deliverables";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { renderReviewPayload, type ReviewVersionInput } from "@/lib/content-studio-review";

/** Latest validate_deterministic run's validator rows for a version, or null. */
async function latestValidationFor(versionId: string): Promise<{ status: string }[] | null> {
  const { data: run } = await supabaseAdmin
    .from("content_ai_runs")
    .select("result")
    .eq("piece_version_id", versionId)
    .eq("run_type", "validate_deterministic")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const result = run?.result as { validators?: { status: string }[] } | undefined;
  return result?.validators ?? null;
}

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
 * advancing to legal_gate in the first place.
 * addVersion({ clientNotificationChoice: "silent" }) means no notification
 * fires; the version-drift guard in deliverables.ts
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
  const latestValidationResults = version ? await latestValidationFor(version.id) : null;

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

  // Ses.17 WP-4: when a current PT version exists, it is posted beneath the EN
  // content behind a labeled divider. One sign-off then covers both languages;
  // the drift guard in deliverables.ts already forces re-approval whenever any
  // new version (EN or PT) posts after an approval.
  const ptVersion = piece.language_mode === "bilingual" ? await getCurrentVersion(id, "pt") : null;

  // Codex audit F3/F5: the PT half must clear validation before it can reach
  // the lawyer's review surface, exactly as EN does. Previously PT was appended
  // with no validation gate, so a Portuguese draft with fail-severity findings
  // could ship into review under an EN-only zero-fail run.
  if (ptVersion) {
    const ptValidation = await latestValidationFor(ptVersion.id);
    const ptEntry = checkLegalGateEntryCondition({
      hasCurrentVersion: true,
      latestValidationResults: ptValidation,
    });
    if (!ptEntry.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Portuguese version: ${ptEntry.reason}`,
          code: "send_to_review_pt_blocked",
        },
        { status: 422 }
      );
    }
  }

  const html = renderReviewPayload({
    format: piece.format,
    languageMode: piece.language_mode,
    en: version as ReviewVersionInput,
    pt: (ptVersion as ReviewVersionInput | null) ?? null,
  });

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
    clientNotificationChoice: "silent",
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
