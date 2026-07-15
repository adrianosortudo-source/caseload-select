/**
 * GET /api/admin/content-periods/[periodId]/content-export
 *
 * Read-only, operator-only publishing bundle for a content period: exact,
 * already-stored deliverable content, so an operator or a publishing agent
 * can retrieve what already exists in the client portal without searching
 * the filesystem, guessing asset locations, or regenerating anything.
 *
 * This is a SEPARATE feature from the publication-manifest route above it
 * in this same directory tree. It does not extend, redesign, or depend on
 * Publication Readiness; see content-period-export.ts's module header for
 * the full boundary statement.
 *
 * Auth: operator session only (requireOperator). No cron-bearer bypass:
 * unlike publication-manifest, nothing in this spec calls for an
 * unattended cron caller, so none is added.
 *
 * Query params:
 *   format   json (default) | markdown
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { buildContentExportBundle, renderContentExportMarkdown } from "@/lib/content-period-export";

export async function GET(req: NextRequest, { params }: { params: Promise<{ periodId: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { periodId } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "markdown" ? "markdown" : "json";

  const result = await buildContentExportBundle(periodId);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.error === "period not found" ? 404 : 500 },
    );
  }

  if (format === "markdown") {
    return new NextResponse(renderContentExportMarkdown(result.bundle), {
      status: 200,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  }

  return NextResponse.json({ ok: true, bundle: result.bundle }, { status: 200 });
}
