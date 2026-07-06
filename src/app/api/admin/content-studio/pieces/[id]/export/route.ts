import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { getPiece, getCurrentVersion, resolvePublishGateStatus } from "@/lib/content-studio";
import { checkLegalGateExitCondition } from "@/lib/content-studio-gates";
import {
  renderServicePageExport,
  renderMarkdownExport,
  type ServicePageBlock,
} from "@/lib/content-studio-structured";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const EXPORT_BUCKET = "firm-files";
const SIGNED_URL_TTL = 3600; // 1 hour

/**
 * POST /api/admin/content-studio/pieces/[id]/export
 *
 * The mechanism, not the publication: renders the piece's current version
 * into a standalone HTML bundle (page.html, schema.json, meta.json) and
 * writes it to the firm-files bucket under a deterministic, versioned path.
 * No public surface is touched; this route never deploys, posts, or emails
 * anything. Requires the same legal_gate exit condition as advancing to
 * production (linked deliverable approved, or an active publish delegation
 * covers the format), so an export cannot happen ahead of lawyer sign-off.
 *
 * Ses.17 WP-4: accepts an optional { language: "pt" } body (default "en").
 * PT export requires a current PT version and renders the Portuguese LSO
 * banner via wrapExportDocument's language param.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const language: "en" | "pt" = body?.language === "pt" ? "pt" : "en";

  const { data: piece, error: pieceErr } = await getPiece(id);
  if (pieceErr || !piece) {
    return NextResponse.json(
      { ok: false, error: pieceErr?.message ?? "Piece not found" },
      { status: pieceErr ? 500 : 404 }
    );
  }

  if (language === "pt" && piece.language_mode !== "bilingual") {
    return NextResponse.json(
      { ok: false, error: "This piece is not bilingual; it has no Portuguese version to export." },
      { status: 400 }
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
      { ok: false, error: exitCheck.reason, code: "export_blocked" },
      { status: 422 }
    );
  }

  const version = await getCurrentVersion(id, language);
  if (!version) {
    return NextResponse.json(
      { ok: false, error: `No current ${language.toUpperCase()} version to export.` },
      { status: 422 }
    );
  }

  const bundle =
    piece.format === "canonical_service_page"
      ? renderServicePageExport(
          (version.body_structured as ServicePageBlock[] | null) ?? [],
          (version.seo_metadata as Record<string, unknown> | null) ?? undefined,
          language
        )
      : renderMarkdownExport(
          version.body_markdown as string | null,
          {
            title: piece.title_working as string,
            metaDescription:
              ((piece.source_brief as Record<string, unknown> | null)?.answer_summary as
                | string
                | undefined) ?? "",
          },
          version.seo_metadata as Record<string, unknown> | null,
          language
        );

  // Language-scoped prefix: EN and PT versions of the same piece are
  // numbered independently (getNextVersionNumber is scoped per language), so
  // without the language segment an EN v1 and a PT v1 would collide at the
  // same storage path.
  const prefix = `exports/content-studio/${id}/${language}/v${version.version_number}`;
  const files: Array<{ name: string; path: string; body: string; contentType: string }> = [
    { name: "page.html", path: `${prefix}/page.html`, body: bundle.pageHtml, contentType: "text/html; charset=utf-8" },
    {
      name: "schema.json",
      path: `${prefix}/schema.json`,
      body: JSON.stringify(bundle.schemaJsonLd, null, 2),
      contentType: "application/json",
    },
    {
      name: "meta.json",
      path: `${prefix}/meta.json`,
      body: JSON.stringify(bundle.meta, null, 2),
      contentType: "application/json",
    },
  ];

  const signedUrls: Record<string, string> = {};
  for (const file of files) {
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(EXPORT_BUCKET)
      .upload(file.path, Buffer.from(file.body, "utf8"), {
        contentType: file.contentType,
        upsert: true, // deterministic path per version: re-export overwrites, does not conflict
      });
    if (uploadErr) {
      return NextResponse.json(
        { ok: false, error: `Failed to write ${file.path}: ${uploadErr.message}` },
        { status: 500 }
      );
    }
    const { data: signed } = await supabaseAdmin.storage
      .from(EXPORT_BUCKET)
      .createSignedUrl(file.path, SIGNED_URL_TTL);
    if (signed?.signedUrl) signedUrls[file.name] = signed.signedUrl;
  }

  return NextResponse.json({
    ok: true,
    piece_id: id,
    version_number: version.version_number,
    storage_prefix: prefix,
    signed_urls: signedUrls,
  });
}
