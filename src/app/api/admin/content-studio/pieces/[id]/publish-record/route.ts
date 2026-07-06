import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import {
  getPiece,
  updatePiece,
  getCurrentVersion,
  resolvePublishGateStatus,
  checkApprovalIdentity,
} from "@/lib/content-studio";
import { checkLegalGateExitCondition } from "@/lib/content-studio-gates";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/content-studio/pieces/[id]/publish-record
 *
 * Records that the operator manually placed an exported bundle on a public
 * surface. This route does not publish anything itself: it takes the
 * published_url the operator confirms, stamps { url, at, exported_version }
 * onto the current version's seo_metadata (not source_brief, which the
 * brief-edit form can overwrite), and sets the piece's status to the
 * existing 'published' value on the content_pieces_status_check CHECK
 * constraint. Same legal_gate exit condition as export: a piece cannot be
 * marked published without a lawyer-approved deliverable (or an active
 * delegation), which would defeat the entire point of the legal gate.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const publishedUrl =
    typeof (body as Record<string, unknown>)?.published_url === "string"
      ? ((body as Record<string, unknown>).published_url as string).trim()
      : "";

  if (!publishedUrl || !/^https?:\/\//.test(publishedUrl)) {
    return NextResponse.json(
      { ok: false, error: "published_url is required and must be an absolute http(s) URL." },
      { status: 400 }
    );
  }

  const { data: piece, error: pieceErr } = await getPiece(id);
  if (pieceErr || !piece) {
    return NextResponse.json(
      { ok: false, error: pieceErr?.message ?? "Piece not found" },
      { status: pieceErr ? 500 : 404 }
    );
  }

  const { deliverableStatus, delegation } = await resolvePublishGateStatus(piece);
  const exitCheck = checkLegalGateExitCondition({
    deliverableStatus,
    delegation,
    format: piece.format as string,
  });
  if (!exitCheck.ok) {
    return NextResponse.json(
      { ok: false, error: exitCheck.reason, code: "publish_record_blocked" },
      { status: 422 }
    );
  }

  // Codex audit F1/F3: recording a publish is an assertion that the approved
  // content is live. Bind it to the exact lawyer-approved version; a
  // post-approval drift must be re-reviewed first.
  const identity = await checkApprovalIdentity({
    id,
    firm_id: piece.firm_id,
    format: piece.format,
    language_mode: piece.language_mode,
    deliverable_id: piece.deliverable_id,
  });
  if (!identity.ok) {
    return NextResponse.json(
      { ok: false, error: identity.reason, code: identity.code },
      { status: 422 }
    );
  }

  const version = await getCurrentVersion(id, "en");
  if (!version) {
    return NextResponse.json(
      { ok: false, error: "No current EN version to record a publish against." },
      { status: 422 }
    );
  }

  const publishRecord = {
    url: publishedUrl,
    at: new Date().toISOString(),
    exported_version: version.version_number,
  };
  const nextSeoMetadata = {
    ...((version.seo_metadata as Record<string, unknown> | null) ?? {}),
    publish_record: publishRecord,
  };

  const { error: versionUpdateErr } = await supabaseAdmin
    .from("content_piece_versions")
    .update({ seo_metadata: nextSeoMetadata })
    .eq("id", version.id);
  if (versionUpdateErr) {
    return NextResponse.json(
      { ok: false, error: `Failed to record publish on version: ${versionUpdateErr.message}` },
      { status: 500 }
    );
  }

  const { data: updated, error: pieceUpdateErr } = await updatePiece(id, { status: "published" });
  if (pieceUpdateErr) {
    return NextResponse.json(
      { ok: false, error: `Failed to set piece status: ${pieceUpdateErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, piece: updated, publish_record: publishRecord });
}
